// remoteLogger.js
// Enlaza los métodos de console para enviar los logs a un endpoint PHP mediante sendBeacon/fetch.
(() => {
  const sessionId = (Date.now().toString(36)+Math.random().toString(36).substr(2,5)).toUpperCase();
  function serialize(arg) {
    try {
      if (arg instanceof Error) {
        return `${arg.message}\n${arg.stack}`;
      }
      if (typeof arg === 'object') return JSON.stringify(arg);
      return String(arg);
    } catch (e) {
      return '[unserializable]';
    }
  }

  function post(endpoint, level, message) {
    const payload = JSON.stringify({
      level,
      message,
      url: location.href,
      ua: navigator.userAgent,
      sessionId,
      lang: navigator.language,
      ts: Date.now()
    });
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(endpoint, blob);
      } else {
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true
        });
      }
    } catch (err) {
      console && console.warn && console.warn('remoteLogger post error', err);
    }
  }

  window.initRemoteLogger = function (endpoint) {
    const levels = ['log', 'info', 'warn', 'error', 'debug', 'trace'];
    levels.forEach(level => {
      const original = console[level] ? console[level].bind(console) : console.log.bind(console);
      console[level] = (...args) => {
        original(...args);
        post(endpoint, level, args.map(serialize).join(' '));
      };
    });

    // También capturamos errores globales
    window.addEventListener('error', evt => {
      post(endpoint, 'page-error', serialize(evt.error || evt.message));
    });
    window.addEventListener('unhandledrejection', evt => {
      post(endpoint, 'unhandledrejection', serialize(evt.reason));
    });

    console.info('remoteLogger inicializado, enviando a ' + endpoint + ' id=' + sessionId);
  };
})(); 