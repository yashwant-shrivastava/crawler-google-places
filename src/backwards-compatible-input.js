const Apify = require('apify');

const { log } = Apify.utils;

// Small hack for backward compatibillity
// Previously there was a checkbox includeImages and includeReviews. It had to be on.
// maxImages and maxReviews 0 or empty scraped all
// Right now, it works like you woudl expect, 0 or empty means no images, for all images just set 99999
// If includeReviews/includeImages is not present, we process regularly
module.exports = (input) => {
    // Deprecated on 2020-07
    if (input.includeReviews !== undefined || input.includeImages !== undefined) {
        log.warning('DEPRECATION: includeReviews and includeImages input fields have been deprecated and will be removed soon! Use maxImage and maxReviews instead');
    }
    if (input.includeReviews === true && !input.maxReviews) {

        input.maxReviews = 999999;
    }

    if (input.includeReviews === false) {
        input.maxReviews = 0;
    }

    if (input.includeImages === true && !input.maxImages) {
        input.maxImages = 999999;
    }

    if (input.includeImages === false) {
        input.maxImages = 0;
    }

    // Deprecated on 2020-10-27
    if (input.forceEng) {
        log.warning('DEPRECATION: forceEng input field have been deprecated and will be removed soon! Use language instead');
        input.language = 'en';
    }
};
