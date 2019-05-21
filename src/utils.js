const Apify = require('apify');

/**
 * Store screen from puppeteer page to Apify key-value store
 * @param page - Instance of puppeteer Page class https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#class-page
 * @param [key] - Function stores your screen in Apify key-value store under this key
 * @return {Promise<void>}
 */
const saveScreenshot = async (page, key = 'OUTPUT') => {
    const screenshotBuffer = await page.screenshot({ fullPage: true });
    await Apify.setValue(key, screenshotBuffer, { contentType: 'image/png' });
};

/**
 * Store HTML content of page to Apify key-value store
 * @param page - Instance of puppeteer Page class https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#class-page
 * @param [key] - Function stores your HTML in Apify key-value store under this key
 * @return {Promise<void>}
 */
const saveHTML = async (page, key = 'OUTPUT') => {
    const html = await page.content();
    await Apify.setValue(key, html, { contentType: 'text/html; charset=utf-8' });
};

module.exports = {
    saveScreenshot,
    saveHTML,
};
