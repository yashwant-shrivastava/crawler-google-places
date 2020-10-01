## 2020-10-01
- added several browser options to input - `maxConcurrency`, `maxPageRetries`, `pageLoadTimeoutSec`, `maxPagesPerBrowser`, `useChrome`

## 2020-09-22
- added few extra review fields (ID, URL)

## 2020-07-23 small features
### New features
 - add option for caching place location
 - add option for sorting of reviews
 - add stats logging

## 2020-07 polygon search and bug fixes
### breaking change
 - reworked input search string

### Bug fixes
 - opening hour parsing (#39)
 - separate locatedIn field (#32)
 - update readme

### New features
 - extract additional info - Service Options, Highlights, Offerings,.. (#41)
 - add `maxReviews`, `maxImages` (#40)
 - add `temporarilyClosed` and `permanentlyClosed` flags (#33)
 - allow to scrape only places urls (#29)
 - add `forceEnglish` flag into input (#24, #21)
 - add searching in polygon using nominatim.org
 - add startUrls
 - added `maxAutomaticZoomOut` to limit how far can Google zoom out (it naturally zooms out as you press next page in search)

