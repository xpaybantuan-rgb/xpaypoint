# SKIEESTORE Payment Listener (Android)

Prototype Android notification listener for DANA Bisnis and GoPay Merchant.

## Important safety boundary
This app forwards notification text as an **unverified payment candidate**. It must never be treated as proof of payment and must never trigger VIPayment fulfillment by itself. Notifications can be duplicated, delayed, edited, or spoofed by other apps. Only an official signed provider callback or a separately verified merchant transaction record may mark an order paid.

## Build
A GitHub Actions workflow builds a debug APK when files in this folder change. Open the repository Actions tab, run **Build SKIEESTORE Payment Listener APK**, then download the `skieestore-payment-listener-debug` artifact. This is a debug build, not a Play Store release.

## Setup
1. Install the app on the Android phone that receives merchant notifications.
2. Open SKIEESTORE Listener. The backend URL is prefilled: `https://skieestore-payment-engine.xpaybantuan.workers.dev/v1/payment/listener/notification`. Enter the device token supplied by the SKIEESTORE administrator.
3. Enable notification access for SKIEESTORE Listener in Android Settings.
4. Enable transaction notifications in DANA Bisnis and GoPay Merchant.
5. Make a small test payment and inspect the received notification fields in the app/backend logs.

## Cloudflare setup
The Worker route is `POST /v1/payment/listener/notification`. It requires the Cloudflare Worker secret `PAYMENT_LISTENER_TOKEN`. The route stores notification candidates in `public.xpaypoint_payment_notification_candidates` and returns HTTP 202. It never changes payment/order status and never starts VIPayment fulfillment.

## Required backend contract
POST JSON to `/v1/payment/listener/notification` with header `X-Listener-Token`.

Payload fields: `sourcePackage`, `title`, `text`, `bigText`, `receivedAt`, `notificationKey`.

The backend must store these as pending/unverified candidates only. Do not automatically mark orders paid based only on these fields.

## Limitations
- Android must keep notification access enabled.
- The phone must be online for forwarding; this prototype does not yet implement a durable offline queue.
- Notification formats vary by app version, device, and language. Real samples are required before writing safe DANA/GoPay parsers.
- This project does not bypass merchant app security, read private app databases, or access credentials/OTP.
