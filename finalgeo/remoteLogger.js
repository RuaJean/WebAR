// remoteLogger.js
// Enlaza los métodos de console para enviar los logs a un endpoint PHP mediante sendBeacon/fetch.
(function(){
  function serialize(arg){
    try{
      if(typeof arg === 'object') return JSON.stringify(arg);
      return String(arg);
    }catch(e){
      return '[unserializable]';
    }
  }

  window.initRemoteLogger = function(endpoint){
    ['log','info','warn','error'].forEach(function(level){
      const original = console[level].bind(console);
      console[level] = function(...args){
        original(...args);
        const msg = args.map(serialize).join(' ');
        const payload = JSON.stringify({level, message: msg});
        try{
          if(navigator.sendBeacon){
            const blob = new Blob([payload], {type:'application/json'});
            navigator.sendBeacon(endpoint, blob);
          }else{
            fetch(endpoint, {method:'POST', headers:{'Content-Type':'application/json'}, body: payload, keepalive: true});
          }
        }catch(e){
          original('remoteLogger error', e);
        }
      };
    });
  };
})(); 