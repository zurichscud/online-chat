import { configFromScript } from './config';
import { ChatWidget } from './widget';

// 同一个页面重复引入脚本时只初始化一次。
if (!window.ShiguangChat) {
  const script =
    document.currentScript instanceof HTMLScriptElement ? document.currentScript : null;
  const widget = new ChatWidget(configFromScript(script));
  window.ShiguangChat = widget.api;
}
