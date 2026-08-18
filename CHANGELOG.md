# Changelog

## [0.2.0](https://github.com/doscientos-es/verifactu/compare/v0.1.11...v0.2.0) (2026-08-18)


### Features

* add runtime fiscal validation tests for submission and cancellation functions ([8abf9e5](https://github.com/doscientos-es/verifactu/commit/8abf9e59730b48973dd3cbc9c6c3c1fbdafeec9a))
* add schema validation script to check AEAT XSDs against local files ([f63aaec](https://github.com/doscientos-es/verifactu/commit/f63aaec011a47fda1a1c9474d493e4807e291483))
* add XML schema validation and copy script for deployment ([4b69cdc](https://github.com/doscientos-es/verifactu/commit/4b69cdcc312e52b161f278afb09eba7f859ff1dc))
* enhance AEAT XSD validation and update invoice handling in Verifactu ([60add50](https://github.com/doscientos-es/verifactu/commit/60add5041b8849484b28a777fcca328a703ee7a4))
* enhance validation logic for references and external inputs in submission and cancellation functions ([379c7cf](https://github.com/doscientos-es/verifactu/commit/379c7cf98939794943cafa9b9b28355e27370621))
* preserve AEAT code for operational follow-up and add AEAT update procedure documentation ([0fb0e1f](https://github.com/doscientos-es/verifactu/commit/0fb0e1fe561336d902994ca66fd021d9207b59f1))
* replace date formatting with spanishDate function for consistency in invoice handling ([2ca659c](https://github.com/doscientos-es/verifactu/commit/2ca659c703630fdfa2a1d7798cf664d44d152f11))
* restructure package manager configuration and move overrides to pnpm-workspace.yaml ([61084bd](https://github.com/doscientos-es/verifactu/commit/61084bd5d7074e6ec26169509785360297f17654))
* update release workflow and add conventional PR title validation ([05218c6](https://github.com/doscientos-es/verifactu/commit/05218c6e24ef83ac40ced3313f2c4d7958ff45ec))


### Bug Fixes

* ensure valid base values in hasValidAmounts function to prevent NaN results ([3548ea0](https://github.com/doscientos-es/verifactu/commit/3548ea04e3b6b7cd8750fe4e2ebb6f2b6baeabdf))
* update nanoid and postcss versions in pnpm-lock.yaml for compatibility ([828ac1e](https://github.com/doscientos-es/verifactu/commit/828ac1e9b39a430093c856af0a482101252210ee))
