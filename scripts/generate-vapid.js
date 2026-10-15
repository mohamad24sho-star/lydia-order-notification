const webpush = require("web-push");
const keys = webpush.generateVAPIDKeys();
console.log("Add these values to your environment / hosting secrets:");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
