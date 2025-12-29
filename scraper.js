/**
 * Google AI Studio Apps Scraper
 * Extracts all apps from aistudio.google.com/apps?source=user
 * with checkpoint/resume capability
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const CONFIG = {
  baseUrl: 'https://aistudio.google.com/apps?source=user',
  outputDir: './data',
  thumbnailsDir: './thumbnails',
  checkpointFile: './data/checkpoint.json',
  appsFile: './data/apps.json',
  itemsPerPage: 50,
  screenshotDelay: 1000,
};

// Ensure directories exist
function ensureDirectories() {
  [CONFIG.outputDir, CONFIG.thumbnailsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`✓ Created directory: ${dir}`);
    }
  });
}

// Load checkpoint to resume from where we left off
function loadCheckpoint() {
  if (fs.existsSync(CONFIG.checkpointFile)) {
    const checkpoint = JSON.parse(fs.readFileSync(CONFIG.checkpointFile, 'utf-8'));
    console.log(`📌 Resuming from page ${checkpoint.lastPage + 1}, app ${checkpoint.lastAppIndex}`);
    return checkpoint;
  }
  return { lastPage: 0, lastAppIndex: -1, totalApps: 0, apps: [] };
}

// Save checkpoint after each page
function saveCheckpoint(checkpoint) {
  fs.writeFileSync(CONFIG.checkpointFile, JSON.stringify(checkpoint, null, 2));
  console.log(`💾 Checkpoint saved: page ${checkpoint.lastPage}, ${checkpoint.apps.length} apps total`);
}

// Save final apps.json
function saveApps(apps) {
  fs.writeFileSync(CONFIG.appsFile, JSON.stringify(apps, null, 2));
  console.log(`✅ Saved ${apps.length} apps to ${CONFIG.appsFile}`);
}

async function scrapeAIStudioApps() {
  console.log('🚀 Starting Google AI Studio Apps Scraper\n');
  ensureDirectories();
  
  const checkpoint = loadCheckpoint();
  let browser, context, page;

  try {
    console.log('🌐 Launching browser...');
    browser = await chromium.launch({ headless: false });
    context = await browser.newContext();
    page = await context.newPage();

    console.log('📄 Navigating to AI Studio...');
    await page.goto(CONFIG.baseUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Click on "Created by you" tab
    console.log('🔍 Selecting "Created by you" tab...');
    const createdByYouButton = page.locator('button:has-text("Created by you")');
    await createdByYouButton.click();
    await page.waitForTimeout(2000);

    // Extract total count
    const paginationText = await page.locator('text=/\\d+ – \\d+ of \\d+/').textContent();
    const totalMatch = paginationText.match(/of (\d+)/);
    const totalApps = totalMatch ? parseInt(totalMatch[1]) : 0;
    console.log(`📊 Total apps found: ${totalApps}\n`);

    let currentPage = checkpoint.lastPage;
    const totalPages = Math.ceil(totalApps / CONFIG.itemsPerPage);

    // Navigate to the checkpoint page if resuming
    if (currentPage > 0) {
      console.log(`⏩ Fast-forwarding to page ${currentPage + 1}...`);
      for (let i = 0; i < currentPage; i++) {
        await page.locator('button[aria-label="Next page"]').click();
        await page.waitForTimeout(2000);
      }
    }

    // Scrape all pages
    for (let pageNum = currentPage; pageNum < totalPages; pageNum++) {
      console.log(`\n📖 Processing page ${pageNum + 1}/${totalPages}...`);

      // Wait for apps to load
      await page.waitForSelector('a[href*="/apps/"]', { timeout: 10000 });
      await page.waitForTimeout(1500);

      // Extract app data from current page
      const appsOnPage = await page.evaluate(() => {
        const apps = [];
        const rows = document.querySelectorAll('table tbody tr, [role="row"]');
        
        rows.forEach((row, idx) => {
          const titleLink = row.querySelector('a[href*="/apps/"]');
          if (!titleLink) return;

          const title = titleLink.textContent.trim();
          const url = titleLink.href;
          const descElement = row.querySelector('p, [class*="description"]');
          const description = descElement ? descElement.textContent.trim() : '';
          
          const dateElement = row.querySelector('text=/Last modified:/, time');
          const lastModified = dateElement ? dateElement.textContent.trim() : '';

          if (title && url) {
            apps.push({ title, url, description, lastModified });
          }
        });

        return apps;
      });

      console.log(`   Found ${appsOnPage.length} apps on this page`);

      // Add apps to checkpoint
      appsOnPage.forEach((app, idx) => {
        const globalIndex = checkpoint.apps.length;
        app.id = `app_${String(globalIndex + 1).padStart(4, '0')}`;
        app.thumbnail = `thumbnails/${app.id}.png`;
        checkpoint.apps.push(app);
        console.log(`   ✓ ${app.id}: ${app.title}`);
      });

      // Update checkpoint
      checkpoint.lastPage = pageNum;
      checkpoint.lastAppIndex = checkpoint.apps.length - 1;
      checkpoint.totalApps = totalApps;
      saveCheckpoint(checkpoint);

      // Go to next page (if not last)
      if (pageNum < totalPages - 1) {
        console.log('   ⏭  Moving to next page...');
        await page.locator('button[aria-label="Next page"]').click();
        await page.waitForTimeout(2000);
      }
    }

    // Save final output
    console.log('\n🎉 Scraping complete!');
    saveApps(checkpoint.apps);
    console.log(`\n✨ Successfully scraped ${checkpoint.apps.length} apps`);
    console.log(`📁 Data saved to: ${CONFIG.appsFile}`);
    console.log(`\n🌐 Next step: Run 'node generate-site.js' to create the public catalog`);

  } catch (error) {
    console.error('\n❌ Error during scraping:', error.message);
    console.log('💡 Don\'t worry! Progress has been saved.');
    console.log('   Run the script again to resume from where it left off.');
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Run the scraper
if (require.main === module) {
  scrapeAIStudioApps().catch(console.error);
}

module.exports = { scrapeAIStudioApps };
