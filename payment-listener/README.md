# XPAYPOINT Payment Listener (Android)

Prototype Android notification listener for DANA Bisnis and GoPay Merchant.

## Important safety boundary
This app forwards notification text as an **unverified payment candidate**. It must never be treated as proof of payment and must never trigger VIPayment fulfillment by itself. Notifications can be duplicated, delayed, edited, or spoofed by other apps. Only an official signed provider callback or a separately verified merchant transaction record may mark an order paid.

## Build
Open this folder as an Android Studio project (or copy the module into an Android project), sync Gradle, then build an APK.

## Setup
1. Install the app on the Android phone that receives merchant notifications.
2. Open XPAYPOINT Listener and enter the backend listener URL and device token supplied by the XPAYPOINT administrator.
3. Enable notification access for XPAYPOINT Listener in Android Settings.
4. Enable transaction notifications in DANA Bisnis and GoPay Merchant.
5. Make a small test payment and inspect the received notification fields in the app/backend logs.

## Required backend contract
POST JSON to `/v1/payment/listener/notification` with header `X-Listener-Token`.

Payload fields: `sourcePackage`, `title`, `text`, `bigText`, `receivedAt`, `notificationKey`.

The backend must store these as pending/unverified candidates only. Do not automatically mark orders paid based only on these fields.

## Limitations
- Android must keep notification access enabled.
- The phone must be online for forwarding; this prototype does not yet implement a durable offline queue.
- Notification formats vary by app version, device, and language. Real samples are required before writing safe DANA/GoPay parsers.
- This project does not bypass merchant app security, read private app databases, or access credentials/OTP.
