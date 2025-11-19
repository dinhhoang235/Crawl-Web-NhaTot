const { connect } = require('puppeteer-real-browser');
const { url1 } = require('./urls');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

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
// ...existing code...

async function main() {
    console.log('🚀 Khởi động browser với chế độ bypass Cloudflare...');
    
    const { browser, page } = await connect({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process'
        ],
        customConfig: {},
        turnstile: true,
        connectOption: {
            defaultViewport: null
        },
        disableXvfb: false,
        ignoreAllFlags: false
    });
    
    console.log('✅ Browser đã khởi động');
    
    // 🔧 TỐI ƯU 1: Chờ page load hoàn toàn trước Cloudflare check
    console.log('🌐 Đang truy cập trang web...');
    let retries = 3;
    let pageLoaded = false;
    
    while (retries > 0 && !pageLoaded) {
        try {
            await page.goto(url1, { 
                waitUntil: 'networkidle2',
                timeout: 90000 
            });
            
            // 🔧 TỐI ƯU 2: Chờ lâu hơn và check nhiều lần
            console.log('⏳ Đợi Cloudflare check...');
            let cloudflareDetected = true;
            let waitAttempts = 0;
            
            while (cloudflareDetected && waitAttempts < 4) {
                await delay(5000 + waitAttempts * 2000); // 5s, 7s, 9s, 11s
                waitAttempts++;
                
                const bodyText = await page.evaluate(() => document.body.innerText);
                cloudflareDetected = bodyText.includes('Checking your browser') || 
                                   bodyText.includes('Just a moment') || 
                                   bodyText.includes('bỏ chặn') ||
                                   bodyText.includes('Enable JavaScript');
                
                if (cloudflareDetected) {
                    console.log(`🔄 Cloudflare đang check (lần ${waitAttempts})...`);
                } else {
                    console.log('✅ Cloudflare check xong!');
                }
            }
            
            // Final check - nếu vẫn bị chặn thì throw error
            const finalBodyText = await page.evaluate(() => document.body.innerText);
            if (finalBodyText.includes('Checking your browser') || 
                finalBodyText.includes('bỏ chặn')) {
                throw new Error('Cloudflare vẫn chặn sau 4 lần check');
            }
            
            pageLoaded = true;
            console.log('✅ Trang đã load thành công!');
            
        } catch (e) {
            retries--;
            console.error(`❌ Lỗi khi tải trang (còn ${retries} lần thử): ${e.message}`);
            if (retries === 0) {
                await browser.close();
                throw e;
            }
            await delay(5000);
        }
    }

    try {
        // 🔧 TỐI ƯU 3: Thêm fallback selector
        let listSelector = 'li.ard7gu7';
        let listElements = await page.$$(listSelector);
        
        if (listElements.length === 0) {
            console.log('⚠️ Selector mặc định không tìm thấy, thử fallback...');
            const fallbackSelectors = ['li[class*="ard7gu7"]', 'li[class*="listing"]', 'li'];
            
            for (const selector of fallbackSelectors) {
                listElements = await page.$$(selector);
                if (listElements.length > 0) {
                    listSelector = selector;
                    console.log(`✅ Tìm thấy ${listElements.length} items với selector: ${selector}`);
                    break;
                }
            }
        }
        
        await page.waitForSelector(listSelector, { timeout: 30000 });
    } catch (e) {
        console.error('❌ Không tìm thấy selector listings');
        await browser.close();
        throw e;
    }

    let currentPage = 1;
    let consecutiveNoRecentPages = 0;
    let hasFoundRecentBefore = false;

    try {
        while (true) {
            console.log(`📄 Trang ${currentPage}`);

            const itemElements = await page.$$('li.ard7gu7');
            console.log(`🔍 Số tin trên trang: ${itemElements.length}`);

            let foundRecentPost = false;
            let validInThisPage = 0;

            for (const [index, item] of itemElements.entries()) {
                try {
                    // 🔧 TỐI ƯU 4: Thêm error handling cho mỗi field
                    let link = null;
                    try {
                        const linkElement = await item.$('a.cqzlgv9');
                        if (linkElement) {
                            link = await linkElement.evaluate(el => el.href);
                        }
                    } catch (e) {
                        console.log(`  ⚠️ Không tìm được link item ${index}`);
                        continue;
                    }
                    
                    if (!link || collectedURLs.has(link)) continue;

                    // Get date
                    let dateRaw = null;
                    try {
                        const timeElement = await item.$('span.c1u6gyxh.tx5yyjc');
                        if (timeElement) {
                            dateRaw = await timeElement.evaluate(el => el.innerText.trim().toLowerCase());
                        }
                    } catch (e) {
                        console.log(`  ⚠️ Không tìm được date item ${index}`);
                    }
                    
                    if (!dateRaw) continue;

                    const isToday = dateRaw.includes('hôm nay') || dateRaw.includes('giờ') || dateRaw.includes('phút');
                    const isYesterday = dateRaw.includes('hôm qua');

                    if (!isToday && !isYesterday) continue;
                    foundRecentPost = true;

                    // Get location
                    let locationRaw = null;
                    try {
                        const locationElement = await item.$('span.c1u6gyxh.t1u18gyr');
                        if (locationElement) {
                            locationRaw = await locationElement.evaluate(el => el.innerText.trim().toLowerCase());
                        }
                    } catch (e) {
                        console.log(`  ⚠️ Không tìm được location item ${index}`);
                    }
                    
                    if (!locationRaw) continue;

                    const desiredDistricts = [
                        'cầu giấy', 'đống đa', 'ba đình', 'bắc từ liêm', 'nam từ liêm',
                        'tây hồ', 'hoàng mai', 'hai bà trưng', 'thanh xuân', 'hà đông', 'hoàn kiếm'
                    ];
                    const isDesired = desiredDistricts.some(d => locationRaw.includes(d));
                    if (!isDesired) continue;

                    // Get tin count
                    let tinCount = 0;
                    try {
                        const tinCountElement = await item.$('span.c1k1v7xu');
                        if (tinCountElement) {
                            const tinCountText = await tinCountElement.evaluate(el => el.innerText.trim());
                            const tinMatch = tinCountText.match(/(\d+)/);
                            tinCount = parseInt(tinMatch?.[1] || '0');
                        }
                    } catch (e) {
                        // Ignore tin count error
                    }
                    
                    if (tinCount > 3) continue;

                    validListings.push({
                        Date: formatDateForExcel(dateRaw),
                        Location: locationRaw,
                        URL: link
                    });

                    collectedURLs.add(link);
                    validInThisPage++;

                    console.log(`✅ Hợp lệ: ${locationRaw} - ${dateRaw}`);

                } catch (err) {
                    console.log(`🔥 Lỗi item ${index}: ${err.message}`);
                }
            }

            console.log(`📊 Trang ${currentPage}: ${validInThisPage} tin hợp lệ | Tổng: ${validListings.length}`);

            if (foundRecentPost) {
                consecutiveNoRecentPages = 0;
                hasFoundRecentBefore = true;
            } else {
                if (hasFoundRecentBefore) {
                    consecutiveNoRecentPages++;
                    console.log(`⚠️ Không có bài mới: ${consecutiveNoRecentPages}/15 trang.`);
                    if (consecutiveNoRecentPages >= 15) {
                        console.log('🛑 Dừng crawl.');
                        break;
                    }
                }
            }

            // 🔧 TỐI ƯU 5: Simplified pagination - chỉ dùng cách đơn giản nhất
            await delay(2000);
            
            const currentUrl = page.url();
            const nextPageNumber = currentPage + 1;
            let nextPageUrl = null;

            if (currentUrl.includes('page=')) {
                nextPageUrl = currentUrl.replace(/page=\d+/, `page=${nextPageNumber}`);
            } else if (currentUrl.includes('?')) {
                nextPageUrl = `${currentUrl}&page=${nextPageNumber}`;
            } else {
                nextPageUrl = `${currentUrl}?page=${nextPageNumber}`;
            }

            try {
                await page.goto(nextPageUrl, { 
                    waitUntil: 'domcontentloaded', 
                    timeout: 60000 
                });
                
                // Check if page có listings
                const newItems = await page.$$('li.ard7gu7');
                if (newItems.length === 0) {
                    console.log('✅ Hết trang.');
                    break;
                }
                
                currentPage++;
                await delay(1000); // Delay giữa các trang
                
            } catch (error) {
                console.log(`❌ Không thể chuyển trang: ${error.message}`);
                break;
            }
        }

    } catch (mainError) {
        console.error(`💥 Lỗi crawl: ${mainError.message}`);
        
        if (validListings.length > 0) {
            console.log(`💾 Lưu ${validListings.length} tin...`);
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
        console.log(`💾 Lưu ${validListings.length} tin...`);
        await saveToExcel(validListings, excelFile);
    }
  });
