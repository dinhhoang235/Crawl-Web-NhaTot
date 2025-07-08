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

async function combineExcelData(newData, excelFilePath) {
    try {
        let existingData = [];
        if (fs.existsSync(excelFilePath)) {
            const workbook = XLSX.readFile(excelFilePath);
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            existingData = XLSX.utils.sheet_to_json(sheet);
            console.log(`📊 Tìm thấy ${existingData.length} tin đã có trong Excel`);
        }

        const existingURLs = new Set(existingData.map(d => d.URL));
        const uniqueNew = newData.filter(d => !existingURLs.has(d.URL));
        console.log(`📊 Từ ${newData.length} tin mới, ${uniqueNew.length} tin là duy nhất`);
        
        return [...existingData, ...uniqueNew];
    } catch (error) {
        console.error(`❌ Error combining Excel data: ${error.message}`);
        // If there's an error, just return the new data
        return newData;
    }
}

async function saveToExcel(validListings, excelFile) {
    try {
        // Format data for Excel
        const excelData = validListings.map(item => ({
            'Date': item.Date,
            'Location': item.Location,
            'URL': item.URL
        }));

        // Combine with existing data
        const combinedData = await combineExcelData(excelData, excelFile);

        // Create a new workbook and worksheet
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(combinedData);

        // Add worksheet to workbook
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Valid Listings');

        // Set column widths for better readability
        const columnWidths = [
            { wch: 25 },  // Date column
            { wch: 40 },  // Location column
            { wch: 75 }   // URL column (wide enough for long URLs)
        ];
        worksheet['!cols'] = columnWidths;

        // Write to file
        XLSX.writeFile(workbook, excelFile);
        console.log(`📊 Exported ${combinedData.length} listings (${validListings.length} new + ${combinedData.length - validListings.length} existing) to Excel: ${excelFile}`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to create Excel file: ${error.message}`);
        return false;
    }
}

async function main() {
    const browser = await puppeteer.launch({ 
        headless: true, 
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    });
    
    const page = await browser.newPage();
    
    // Set user agent to avoid detection
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    // Add error handling for navigation
    try {
        await page.goto(url1, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (e) {
        console.error('❌ Lỗi khi tải trang:', e.message);
        await browser.close();
        throw e;
    }

    try {
        await page.waitForSelector('a.crd7gu7', { timeout: 30000 });
    } catch (e) {
        console.error('❌ Không tìm thấy selector a.crd7gu7');
        await browser.close();
        throw e;
    }

    let currentPage = 1;
    let consecutiveNoRecentPages = 0;
    let hasFoundRecentBefore = false;

    try {
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
            try {
                // Get the full HTML of pagination for debugging
                const paginationHTML = await paginationContainer.evaluate(el => el.outerHTML);
                console.log(`📝 Pagination HTML: ${paginationHTML.substring(0, 200)}...`);
            } catch (evalError) {
                console.log(`❌ Lỗi khi đọc pagination HTML: ${evalError.message}`);
            }
        }

        // Try multiple approaches to find pagination
        let nextButton = null;
        let foundNextPage = false;

        // Approach 1: Look for pagination buttons
        const paginationButtons = await page.$$('button.Paging_redirectPageBtn__KvsqJ');
        console.log(`🔍 Tìm thấy ${paginationButtons.length} nút pagination`);

        for (const [index, button] of paginationButtons.entries()) {
            try {
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
            } catch (buttonError) {
                console.log(`❌ Lỗi khi kiểm tra button ${index}: ${buttonError.message}`);
            }
        }

        // Approach 2: Look for numbered page links
        if (!nextButton) {
            const pageLinks = await page.$$('div.Paging_pagingItem__Y3r2u a');
            console.log(`🔍 Tìm thấy ${pageLinks.length} link trang số`);

            if (pageLinks.length > 0) {
                const nextPageNumber = currentPage + 1;

                for (const link of pageLinks) {
                    try {
                        const linkText = await link.evaluate(el => el.textContent.trim());
                        console.log(`🔗 Tìm thấy link trang: "${linkText}"`);

                        if (linkText === nextPageNumber.toString()) {
                            console.log(`➡️ Chuyển sang trang ${nextPageNumber} bằng link...`);
                            try {
                                await Promise.all([
                                    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
                                    link.click()
                                ]);
                                await delay(2000);
                                currentPage++;
                                foundNextPage = true;
                                break;
                            } catch (navError) {
                                console.log(`❌ Lỗi navigation khi click link: ${navError.message}`);
                            }
                        }
                    } catch (linkError) {
                        console.log(`❌ Lỗi khi kiểm tra link: ${linkError.message}`);
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
            try {
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
                    nextButton.click()
                ]);
                await delay(2000);
                currentPage++;
                foundNextPage = true;
            } catch (navError) {
                console.log(`❌ Lỗi navigation khi click button: ${navError.message}`);
            }
        }

        // If no method worked, we're done
        if (!foundNextPage) {
            console.log('✅ Hết trang (đã thử tất cả phương pháp).');
            break;
        }
    }

    } catch (mainError) {
        console.error(`💥 Lỗi trong quá trình crawl: ${mainError.message}`);
        
        // Auto-save data when error occurs
        if (validListings.length > 0) {
            console.log(`💾 Đang lưu ${validListings.length} tin đã thu thập được...`);
            await saveToExcel(validListings, excelFile);
        }
        
        await browser.close();
        throw mainError;
    }

    // Save to Excel file
    await saveToExcel(validListings, excelFile);

    await browser.close();
}

main()
  .catch(async err => {
    console.error('💥 Lỗi chính:', err.message);

    if (validListings.length > 0) {
        console.log(`💾 Cố gắng lưu lại ${validListings.length} tin đã crawl...`);
        await saveToExcel(validListings, excelFile);
    } else {
        console.log('⚠️ Không có dữ liệu nào để lưu');
    }
  });
