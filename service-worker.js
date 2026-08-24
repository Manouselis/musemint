chrome.action.onClicked.addListener((tab) => {
  if (tab.id && tab.url?.startsWith("https://music.youtube.com/")) {
    chrome.tabs.sendMessage(tab.id, { type: "MUSEMINT_TOGGLE" }).catch(() => {});
  }
});
