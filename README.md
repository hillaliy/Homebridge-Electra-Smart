<p ALIGN="CENTER">
<img src="https://raw.githubusercontent.com/homebridge/branding/master/logos/homebridge-wordmark-logo-vertical.png" width="200px">
</p>

<SPAN ALIGN="CENTER">

# Homebridge Electra Smart V2

[![Downloads](https://img.shields.io/npm/dt/homebridge-electra-smart-v2.svg?color=critical)](https://www.npmjs.com/package/homebridge-electra-smart-v2)
[![Version](https://img.shields.io/npm/v/homebridge-electra-smart-v2)](https://www.npmjs.com/package/homebridge-electra-smart-v2)

<!-- [![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)<br> -->

Programming is not easy. <br />
If you like this plugin or want to contribute to future development, a donation will help. <br /> <a target="blank" href="https://www.paypal.me/hillaliy"><img src="https://img.shields.io/badge/PayPal-Donate-blue.svg?logo=paypal"/></a><br>

## [Homebridge](https://github.com/nfarina/homebridge) plugin to control Electra Smart Air Conditioners.

<img src="https://www.electra-air.co.il/wp-content/uploads/2021/03/electra-logo.png" width="220px"> &nbsp;
<img src="https://raw.githubusercontent.com/homebridge/branding/master/logos/homebridge-color-round.png" width="150px">

<SPAN ALIGN="Left">

**_Requirements:_**<br>
<img src="https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen"> &nbsp;
<img src="https://img.shields.io/badge/homebridge-%3E%3D1.11.0-brightgreen"> &nbsp;
<img src="https://img.shields.io/badge/homebridge_2.0-supported-purple">

## 🚀 Key Improvements in V2

- **Zero Lag:** Implements background state caching to eliminate the "Slow to Respond" status in the Home app.
- **Unified Polling:** Fetches all device data in a single request every 60 seconds (configurable) to avoid Electra API rate limits.
- **Native Filter Support:** Integrated filter dirty indication and reset functionality within the AC settings.

## 🛰️ Supported Devices

- This plugin supports Electra Smart AC units connected via the Electra Smart Cloud.
- Requires a valid **IMEI** and **Token** (extracted from the Electra app).

## ⚙️ Configuration

You can use the plugin settings or add this to the platforms array in your config.json:

```json
{
  "platform": "ElectraSmartPlatform",
  "name": "Electra Smart AC",
  "imei": "YOUR_IMEI_NUMBER",
  "token": "YOUR_AUTH_TOKEN",
  "options": {
    "pollInterval": 60,
    "hideDryMode": false,
    "hideFanMode": false
  }
}
```
