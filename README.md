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

<img src="branding/icon.png" width="150px"> &nbsp;
<img src="https://raw.githubusercontent.com/homebridge/branding/master/logos/homebridge-color-round.png" width="150px">

<SPAN ALIGN="Left">

**_Requirements:_**<br>
<img src="https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen"> &nbsp;
<img src="https://img.shields.io/badge/homebridge-%3E%3D1.11.0-brightgreen"> &nbsp;
<img src="https://img.shields.io/badge/homebridge_2.0-supported-purple">

## � Authentication Setup

<p ALIGN="CENTER">
<img src="branding/Connect Electra Smart.png" width="600px"><br>
<img src="branding/Verify SMS Code.png" width="600px">
</p>

The plugin provides a simple two-step authentication flow:

1. **Get SMS Code** - Enter your phone number to receive a one-time login code
2. **Verify SMS Code** - Enter the 4-digit code sent to your phone to complete authentication

## 🛰️ Supported Devices

- This plugin supports Electra Smart AC units connected via the Electra Smart Cloud.
- Requires a valid **IMEI** and **Token** (extracted via the authentication setup above).

## ⚙️ Configuration

You can use the plugin settings or add this to the platforms array in your config.json:

```json
{
  "name": "Electra Smart AC",
  "options": {
    "imei": "YOUR_IMEI_NUMBER",
    "token": "YOUR_AUTH_TOKEN",
    "pollInterval": 60,
    "hideDryMode": true,
    "hideFanMode": true
  },
  "platform": "ElectraSmartPlatform"
}
```

> **Note:** `pollInterval`, `hideDryMode`, and `hideFanMode` are default values
>
> **⚠️ Important:** `pollInterval` minimum is 30 seconds due to Electra API limits

## 🌬️ 🌀 Custom Modes

This plugin supports adding custom services for Dry mode and Fan mode to HomeKit.

### Configuration Options

- **`hideDryMode`** - Set to `true` to hide the Dry mode option from HomeKit
- **`hideFanMode`** - Set to `true` to hide the Fan mode option from HomeKit
