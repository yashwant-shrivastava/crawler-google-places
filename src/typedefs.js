const Apify = require('apify'); // eslint-disable-line no-unused-vars

/**
 * Options for the scraping process
 * @typedef ScrapingOptions
 * @property {boolean} includeHistogram
 * @property {boolean} includeOpeningHours
 * @property {boolean} includePeopleAlsoSearch
 * @property {number} maxReviews
 * @property {number} maxImages
 * @property {number} maxCrawledPlaces
 * @property {number} maxAutomaticZoomOut
 * @property {boolean} exportPlaceUrls
 * @property {boolean} additionalInfo
 * @property {boolean} cachePlaces
 * @property {string} reviewsSort
 * @property {string} language
 * @property {number} multiplier
 * @property {object} geo
 */

/**
 * Options to set up the crawler
 * @typedef CrawlerOptions
 * @property {Apify.RequestQueue} requestQueue
 * @property {Apify.ProxyConfiguration} proxyConfiguration
 * @property {Apify.PuppeteerPoolOptions} puppeteerPoolOptions
 * @property {number} maxConcurrency
 * @property {Apify.LaunchPuppeteerFunction} launchPuppeteerFunction
 * @property {boolean} useSessionPool
 * @property {number} pageLoadTimeoutSec
 * @property {number} handlePageTimeoutSecs
 * @property {number} maxRequestRetries
 */
module.exports = {};
