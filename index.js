const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { url1 } = require('./urls');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

puppeteer.use(StealthPlugin());

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const validListings = [];
const collectedURLs = new Set(); // Track URLs within current session
const excelFile = path.join(__dirname, 'nhatot.xlsx');

function formatDateForExcel(dateText) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const format = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

    if (dateText.includes("hôm nay") || dateText.includes("giờ") || dateText.includes("phút")) {
        return format(today);
    } else if (dateText.includes("hôm qua")) {
        return format(yesterday);
    }
    return dateText;
}

async function combineExcelData(newData, filePath) {
    let existingData = [];
    if (fs.existsSync(filePath)) {
        const workbook = XLSX.readFile(filePath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        existingData = XLSX.utils.sheet_to_json(sheet);
        console.log(`📊 Tìm thấy ${existingData.length} tin đã có trong Excel`);
    }

    const existingURLs = new Set(existingData.map(d => d.URL));
    const uniqueNew = newData.filter(d => !existingURLs.has(d.URL));
    console.log(`📊 Từ ${newData.length} tin mới, ${uniqueNew.length} tin là duy nhất`);
    
    return [...existingData, ...uniqueNew];
}

async function main() {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.goto(url1, { waitUntil: 'domcontentloaded', timeout: 60000 });

    try {
        await page.waitForSelector('a.crd7gu7', { timeout: 0 });
    } catch (e) {
        await page.screenshot({ path: 'fail_page.png', fullPage: true });
        console.error('❌ Không tìm thấy selector a.crd7gu7, đã lưu ảnh fail_page.png');
        throw e;
    }

    let currentPage = 1;
    let consecutiveNoRecentPages = 0;
    let hasFoundRecentBefore = false;

    while (true) {
        console.log(`📄 Trang ${currentPage}`);

        const itemElements = await page.$$('a.crd7gu7');
        console.log(`🔍 Số tin trên trang: ${itemElements.length}`);

        let foundRecentPost = false;
        let validInThisPage = 0;

        for (const [index, item] of itemElements.entries()) {
            try {
                const link = await item.evaluate(el => el.href);
                
                // Skip if we already collected this URL in current session
                if (collectedURLs.has(link)) {
                    console.log(`⏭️ Bỏ qua URL đã thu thập: ${link}`);
                    continue;
                }
                
                const wrapper = await item.evaluateHandle(el => el.closest('.webeqpz'));
                if (!wrapper) continue;

                const meta = await wrapper.evaluate(el => {
                    const span = el.querySelector('span.c1u6gyxh.tx5yyjc');
                    return span ? span.innerText.trim() : '';
                });

                if (!meta || !meta.includes('•')) continue;

                const [locationRaw, dateRaw] = meta.split('•').map(t => t.trim().toLowerCase());
                const isToday = dateRaw.includes('hôm nay') || dateRaw.includes('giờ') || dateRaw.includes('phút');
                const isYesterday = dateRaw.includes('hôm qua');

                if (!isToday && !isYesterday) continue;

                foundRecentPost = true;

                const desiredDistricts = [
                    'cầu giấy', 'đống đa', 'ba đình', 'bắc từ liêm', 'nam từ liêm',
                    'tây hồ', 'hoàng mai', 'hai bà trưng', 'thanh xuân', 'hà đông',
                ];
                const isDesired = desiredDistricts.some(d => locationRaw.includes(d));
                if (!isDesired) continue;

                const tinCountText = await wrapper.evaluate(el => {
                    const span = el.querySelector('span.c1k1v7xu');
                    return span ? span.innerText.trim() : '';
                });

                const tinMatch = tinCountText.match(/(\d+)/);
                const tinCount = parseInt(tinMatch?.[1] || '0');
                if (tinCount > 3) continue;

                validListings.push({
                    Date: formatDateForExcel(dateRaw),
                    Location: locationRaw,
                    URL: link
                });

                // Add to collected URLs set
                collectedURLs.add(link);
                validInThisPage++;

                console.log(`✅ Hợp lệ: ${locationRaw} - ${dateRaw}`);

            } catch (err) {
                console.log(`🔥 Lỗi item ${index}: ${err.message}`);
            }
        }

        // Log page completion summary
        console.log(`📊 Kết thúc trang ${currentPage}: Tìm thấy ${validInThisPage} tin hợp lệ | Tổng cộng: ${validListings.length} tin`);

        if (foundRecentPost) {
            consecutiveNoRecentPages = 0;
            hasFoundRecentBefore = true;
        } else {
            if (hasFoundRecentBefore) {
                consecutiveNoRecentPages++;
                console.log(`⚠️ Không có bài mới: ${consecutiveNoRecentPages} trang liên tiếp.`);
                if (consecutiveNoRecentPages >= 15) {
                    console.log('🛑 Dừng lại sau 15 trang không có bài mới.');
                    break;
                }
            }
        }

        // Wait for pagination to load and try multiple selectors
        await delay(2000);

        // Debug: Check if pagination container exists
        const paginationContainer = await page.$('.Paging_Paging__oREgP');
        console.log(`🔍 Pagination container exists: ${paginationContainer !== null}`);

        if (paginationContainer) {
            // Get the full HTML of pagination for debugging
            const paginationHTML = await paginationContainer.evaluate(el => el.outerHTML);
            console.log(`📝 Pagination HTML: ${paginationHTML.substring(0, 200)}...`);
        }

        // Try multiple approaches to find pagination
        let nextButton = null;
        let foundNextPage = false;

        // Approach 1: Look for pagination buttons
        const paginationButtons = await page.$$('button.Paging_redirectPageBtn__KvsqJ');
        console.log(`🔍 Tìm thấy ${paginationButtons.length} nút pagination`);

        for (const [index, button] of paginationButtons.entries()) {
            const buttonInfo = await button.evaluate(btn => {
                const icon = btn.querySelector('i');
                const iconClasses = icon ? Array.from(icon.classList) : [];
                return {
                    hasRightIcon: iconClasses.includes('Paging_rightIcon__3p8MS'),
                    hasDisabledIcon: iconClasses.includes('Paging_rightIconDisable__666wt') || iconClasses.includes('Paging_leftIconDisable__666wt'),
                    disabled: btn.disabled,
                    iconClasses: iconClasses
                };
            });

            console.log(`🔘 Button ${index}: rightIcon=${buttonInfo.hasRightIcon}, disabled=${buttonInfo.disabled || buttonInfo.hasDisabledIcon}, classes=${buttonInfo.iconClasses.join(',')}`);

            if (buttonInfo.hasRightIcon && !buttonInfo.hasDisabledIcon && !buttonInfo.disabled) {
                nextButton = button;
                console.log(`✅ Tìm thấy nút next hợp lệ tại index ${index}`);
                break;
            }
        }

        // Approach 2: Look for numbered page links
        if (!nextButton) {
            const pageLinks = await page.$$('div.Paging_pagingItem__Y3r2u a');
            console.log(`🔍 Tìm thấy ${pageLinks.length} link trang số`);

            if (pageLinks.length > 0) {
                const nextPageNumber = currentPage + 1;

                for (const link of pageLinks) {
                    const linkText = await link.evaluate(el => el.textContent.trim());
                    console.log(`🔗 Tìm thấy link trang: "${linkText}"`);

                    if (linkText === nextPageNumber.toString()) {
                        console.log(`➡️ Chuyển sang trang ${nextPageNumber} bằng link...`);
                        await Promise.all([
                            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
                            link.click()
                        ]);
                        await delay(2000);
                        currentPage++;
                        foundNextPage = true;
                        break;
                    }
                }
            }
        }

        // Approach 3: Try direct URL navigation if we know the pattern
        if (!nextButton && !foundNextPage) {
            const currentUrl = page.url();
            console.log(`🌐 Current URL: ${currentUrl}`);

            // Check if we can construct next page URL
            const nextPageNumber = currentPage + 1;
            let nextPageUrl = null;

            if (currentUrl.includes('page=')) {
                nextPageUrl = currentUrl.replace(/page=\d+/, `page=${nextPageNumber}`);
            } else if (currentUrl.includes('?')) {
                nextPageUrl = `${currentUrl}&page=${nextPageNumber}`;
            } else {
                nextPageUrl = `${currentUrl}?page=${nextPageNumber}`;
            }

            console.log(`🔗 Thử chuyển đến URL: ${nextPageUrl}`);

            try {
                await page.goto(nextPageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                await delay(2000);

                // Check if the page actually changed by looking for listings
                const newItemElements = await page.$$('a.crd7gu7');
                if (newItemElements.length > 0) {
                    console.log(`✅ Thành công chuyển đến trang ${nextPageNumber}`);
                    currentPage++;
                    foundNextPage = true;
                } else {
                    console.log(`❌ Trang ${nextPageNumber} không có tin đăng - có thể đã hết trang`);
                }
            } catch (error) {
                console.log(`❌ Lỗi khi chuyển đến trang ${nextPageNumber}: ${error.message}`);
            }
        }

        // Execute next button click if found
        if (nextButton) {
            console.log('➡️ Chuyển sang trang tiếp theo bằng nút...');
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
                nextButton.click()
            ]);
            await delay(2000);
            currentPage++;
            foundNextPage = true;
        }

        // If no method worked, we're done
        if (!foundNextPage) {
            console.log('✅ Hết trang (đã thử tất cả phương pháp).');
            await page.screenshot({ path: `no_next_page_${currentPage}.png`, fullPage: true });
            break;
        }
    }

    try {
        const combinedData = await combineExcelData(validListings, excelFile);
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(combinedData);
        worksheet['!cols'] = [{ wch: 25 }, { wch: 40 }, { wch: 75 }];
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Valid Listings');
        XLSX.writeFile(workbook, excelFile);
        console.log(`📊 Đã lưu ${combinedData.length} tin vào ${excelFile}`);
    } catch (e) {
        console.error(`❌ Lỗi ghi Excel: ${e.message}`);
    }

    await browser.close();
}

main().catch(err => console.error('💥 Lỗi chính:', err));
