(function () {
  function onReady() {
    if (window.__TAURI__ && window.bghitappConfig?.splash) {
      window.__TAURI__.core.invoke("close_splashscreen");
    }
  }

  if (document.readyState === "complete") {
    onReady();
  } else {
    window.addEventListener("load", onReady);
  }
})();
