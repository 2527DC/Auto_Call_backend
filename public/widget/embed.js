(function () {
  var widgetKey = null;
  var widgetData = null;
  var baseUrl = '';

  var queue = window.vw && window.vw.q ? window.vw.q : [];

  window.vw = function () {
    var args = arguments;
    if (args[0] === 'init') {
      widgetKey = args[1];
      initWidget();
    }
  };

  for (var i = 0; i < queue.length; i++) {
    window.vw.apply(null, queue[i]);
  }

  function initWidget() {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].src && scripts[i].src.indexOf('/widget/embed.js') !== -1) {
        baseUrl = scripts[i].src.replace('/widget/embed.js', '');
        break;
      }
    }

    fetch(baseUrl + '/api/widgets/public/' + widgetKey, {
      headers: {
        'ngrok-skip-browser-warning': 'true'
      }
    })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          widgetData = data.data;
          renderWidget();
        } else {
          console.error('AI Voice Widget Error:', data.message);
        }
      })
      .catch(err => console.error('AI Voice Widget Fetch Error:', err));
  }

  function renderWidget() {
    var container = document.createElement('div');
    container.id = 'ai-voice-widget-container';
    container.style.position = 'fixed';
    container.style.bottom = '20px';
    container.style.right = '20px';
    container.style.zIndex = '999999';
    container.style.width = 'auto';
    container.style.height = 'auto';
    document.body.appendChild(container);

    var button = document.createElement('div');
    button.id = 'ai-voice-widget-button';
    button.style.width = '60px';
    button.style.height = '60px';
    button.style.borderRadius = '50%';
    button.style.backgroundColor = widgetData.branding.primary_color;
    button.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    button.style.cursor = 'pointer';
    button.style.display = 'flex';
    button.style.alignItems = 'center';
    button.style.justifyContent = 'center';
    button.style.transition = 'transform 0.3s ease';

    if (widgetData.branding.icon_url) {
      var img = document.createElement('img');
      img.src = widgetData.branding.icon_url;
      img.style.width = '30px';
      img.style.height = '30px';
      img.style.borderRadius = '50%';
      button.appendChild(img);
    } else {
      button.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>';
    }

    button.onmouseover = function () { this.style.transform = 'scale(1.1)'; };
    button.onmouseout = function () { this.style.transform = 'scale(1)'; };

    button.onclick = function () {
      openChat();
    };

    container.appendChild(button);
  }

  function openChat() {
    if (document.getElementById('ai-voice-widget-iframe')) return;

    var iframe = document.createElement('iframe');
    iframe.id = 'ai-voice-widget-iframe';
    iframe.src = baseUrl + '/widget/voice-widget.html?key=' + widgetKey;
    iframe.style.position = 'fixed';
    iframe.style.bottom = '90px';
    iframe.style.right = '20px';
    iframe.style.width = '350px';
    iframe.style.height = '500px';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '12px';
    iframe.style.boxShadow = '0 8px 24px rgba(0,0,0,0.2)';
    iframe.style.zIndex = '999998';

    document.body.appendChild(iframe);

    window.addEventListener('message', function (event) {
      if (event.data === 'close-ai-widget') {
        var el = document.getElementById('ai-voice-widget-iframe');
        if (el) el.parentNode.removeChild(el);
      }
    });
  }
})();