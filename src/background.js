// Service worker for the starter extension.
// MV3 service workers are ephemeral; persist state via chrome.storage.

chrome.runtime.onInstalled.addListener(() => {
  console.log("Viking Extension installed.");
});
