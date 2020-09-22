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

const stringifyGoogleXrhResponse = (googleResponseString) => {
    return JSON.parse(googleResponseString.replace(')]}\'', ''));
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
    const magicParamD = stringifyGoogleXrhResponse(jsonObject.d);
    const results = magicParamD[0][1];
    results.forEach((result) => {
        if (result[14]) {
            const place = result[14];
            places.push({ placeId: place[78] });
        }
    });
    return places;
};

/**
 * Response from google xhr is kind a weird. Mix of array of array.
 * This function parse reviews from the response body.
 * @param responseBodyBuffer
 * @return [place]
 */
const parseReviewFromResponseBody = (responseBody) => {
    const reviews = [];
    const stringBody = typeof responseBody === 'string'
        ? responseBody
        : responseBody.toString('utf-8');
    const results = stringifyGoogleXrhResponse(stringBody);
    if (!results || !results[2]) return reviews;
    results[2].forEach((reviewArray) => {
        const reviewData = {
            name: reviewArray[0][1],
            text: reviewArray[3],
            publishAt: reviewArray[1],
            likesCount: reviewArray[15],
            reviewId: reviewArray[10],
            reviewUrl: reviewArray[18],
            reviewerId: reviewArray[6],
            reviewerUrl: reviewArray[0][0],
        };
        // On some places google shows reviews from other services like booking
        // There isn't stars but rating for this places reviews
        if (reviewArray[4]) {
            reviewData.stars = reviewArray[4];
        }
        // Trip advisor
        if (reviewArray[25]) {
            reviewData.rating = reviewArray[25][1];
        }
        if (reviewArray[5]) {
            reviewData.responseFromOwnerText = reviewArray[5][1];
        }
        reviews.push(reviewData);
    });
    return reviews;
};

/**
 * Method scrolls page to xpos, ypos.
 */
const scrollTo = (page, elementToScroll, scrollToHeight) => page.evaluate((elementToScroll, scrollToHeight) => {
    const scrollable = document.querySelector(elementToScroll);
    scrollable.scrollTop = scrollToHeight;
}, elementToScroll, scrollToHeight);

const parseZoomFromUrl = (url) => {
    const zoomMatch = url.match(/@[0-9.-]+,[0-9.-]+,([0-9.]+)z/);
    return zoomMatch ? Number(zoomMatch[1]) : null;
}

module.exports = {
    saveScreenshot,
    saveHTML,
    waitForGoogleMapLoader,
    parseSearchPlacesResponseBody,
    parseReviewFromResponseBody,
    scrollTo,
    parseZoomFromUrl,
};
