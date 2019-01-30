const Apify = require('apify');
const rp = require('request-promise');

/**
 * Check if some of proxies work for Google Maps
 * @param proxyConfig
 */
const proxyCheck = async (proxyConfig) => {
    const proxy = Apify.getApifyProxyUrl({ groups: proxyConfig.apifyProxyGroups });

    // Check if user uses Apify Proxy
    if (!proxyConfig.useApifyProxy) {
        return {
            isPass: false,
            message: 'Please use Apify proxy.',
        };
    }

    // Check if user has access to selected proxy group
    try {
        await rp('https://api.apify.com/v2/browser-info/', { proxy, resolveWithFullResponse: true });
    } catch (error) {
        if (error.message.includes('tunneling socket could not be established')) {
            return {
                isPass: false,
                message: 'Please use Apify available proxy group.',
            };
        }
        throw error;
    }

    // NOTE: We need to check it using Proxy component, but we need to implement it in Apify proxy comp.
    // Check if user has access to Google Maps
    // const googleCheck = await rp('http://maps.google.com', { proxy, resolveWithFullResponse: true, simple: false });
    // if (googleCheck.statusCode !== 200) {
    //     const message = proxyConfig.apifyProxyGroups
    //         ? `One of proxy groups ${proxyConfig.apifyProxyGroups.join(',')} failed to connect to Google Maps.`
    //         : 'Cannot connect to Google Maps with auto proxy group try it again.';
    //     return {
    //         isPass: false,
    //         message,
    //     };
    // }

    return { isPass: true };
};

module.exports = {
    proxyCheck,
};
