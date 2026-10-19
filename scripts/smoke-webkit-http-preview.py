#!/usr/bin/env python3
"""Exercise Reelio's capability URL in WebKitGTK without transcoding a source."""
import sys
from urllib.parse import urlsplit
import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

url = urlsplit(sys.argv[1])
if url.scheme != "http" or url.hostname != "127.0.0.1" or not url.path.startswith("/v/"):
    raise SystemExit("Expected a local Reelio preview capability")
window = Gtk.Window(title="Reelio playback test - closes automatically")
window.set_default_size(320, 200)
manager = WebKit2.UserContentManager()
manager.register_script_message_handler("result")
view = WebKit2.WebView.new_with_user_content_manager(manager)
view.get_settings().set_property("media-playback-requires-user-gesture", False)
result = 1


def finish(message):
    global result
    print(message, flush=True)
    result = 0 if message.startswith("passed") else 1
    Gtk.main_quit()
    return False


def receive(_, value):
    message = value.get_js_value().to_string()
    if message.startswith("state:"):
        print(message, flush=True)
    else:
        finish(message)

manager.connect("script-message-received::result", receive)
view.connect("web-process-terminated", lambda *_: finish("failed: WebKit process terminated"))
window.connect("destroy", lambda *_: finish("failed: window closed"))
window.add(view)
window.show_all()
# The token is validated ASCII by the Rust issuer; JSON also prevents script injection.
import json
view.load_html("""<!doctype html><video controls muted width="300" height="160"></video><script>
const v=document.querySelector('video');
setInterval(()=>window.webkit.messageHandlers.result.postMessage('state: '+JSON.stringify({time:v.currentTime,ready:v.readyState,seeking:v.seeking,paused:v.paused,width:v.videoWidth,height:v.videoHeight,frames:v.getVideoPlaybackQuality?.().totalVideoFrames,error:v.error?.code})),3000);
v.onerror=()=>window.webkit.messageHandlers.result.postMessage('failed: media error '+v.error.code);
let target=0, targets=[], completed=[];
const next=()=>{
 target=targets.shift();
 const frame=(_, info)=>{
   if(v.readyState<2||!v.videoWidth||!v.videoHeight||Math.abs(info.mediaTime-target)>.25){v.requestVideoFrameCallback(frame);return;}
   completed.push({target:target.toFixed(3),frame:info.mediaTime.toFixed(3)});
   window.webkit.messageHandlers.result.postMessage('state: decoded '+JSON.stringify(completed[completed.length-1]));
   if(targets.length)setTimeout(next,20);else window.webkit.messageHandlers.result.postMessage('passed: '+v.videoWidth+'x'+v.videoHeight+' decoded paused-seek frames '+JSON.stringify(completed));
 };
 v.requestVideoFrameCallback(frame);
 v.currentTime=target;
};
v.onloadedmetadata=()=>{
 if(!v.requestVideoFrameCallback){window.webkit.messageHandlers.result.postMessage('failed: decoded-frame verification API unavailable');return;}
 targets=[Math.min(60,v.duration*.2),v.duration*.75,v.duration*.15];next();
};
v.src=""" + json.dumps(sys.argv[1]) + ";</script>", "tauri://localhost/")
GLib.timeout_add_seconds(45, lambda: finish("failed: video decode or repeated seeking timed out"))
Gtk.main()
sys.exit(result)
