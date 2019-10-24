const Apify = require('apify');
const { DEFAULT_TIMEOUT } = require('./consts');

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

/**
 * Wait until google map loader disappear
 * @param page
 * @return {Promise<void>}
 */
const waitForGoogleMapLoader = async (page) => {
    if (await page.$('#searchbox')) {
        await page.waitFor(() => !document.querySelector('#searchbox')
            .classList.contains('loading'), { timeout: DEFAULT_TIMEOUT });
    }
    // 2019-05-19: New progress bar
    await page.waitFor(() => !document.querySelector('.loading-pane-section-loading'), { timeout: DEFAULT_TIMEOUT });
};

/**
 * Response from google xhr is kind a weird. Mix of array of array.
 * This function parse places from the response body.
 * @param responseBodyBuffer
 * @return [place]
 */
const parseSearchPlacesResponseBody = (responseBodyBuffer) => {
    const places = [];
    const jsonString = responseBodyBuffer
        .toString('utf-8')
        .replace('/*""*/', '');
    const jsonObject = JSON.parse(jsonString);
    const magicParamD = jsonObject.d.replace(')]}\'','');
    const results = JSON.parse(magicParamD)[0][1];
    results.forEach((result) => {
        if (result[14]) {
            const place = result[14];
            places.push({ placeId: place[78] });
        }
    });
    return places;
};

module.exports = {
    saveScreenshot,
    saveHTML,
    waitForGoogleMapLoader,
    parseSearchPlacesResponseBody,
};
