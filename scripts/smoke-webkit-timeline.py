#!/usr/bin/env python3
"""Verify native WebKitGTK video/audio clocks through two owned capabilities."""
import json
import sys
from urllib.parse import urlsplit
import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

for value in sys.argv[1:]:
    url = urlsplit(value)
    if url.scheme != "http" or url.hostname != "127.0.0.1" or not url.path.startswith("/v/"):
        raise SystemExit("Expected owned preview capabilities")
if len(sys.argv) != 3:
    raise SystemExit("Expected video and audio capability URLs")
manager = WebKit2.UserContentManager()
manager.register_script_message_handler("result")
view = WebKit2.WebView.new_with_user_content_manager(manager)
view.get_settings().set_property("media-playback-requires-user-gesture", False)
window = Gtk.Window(title="Reelio native timeline audio verification")
window.set_default_size(320, 200)
window.add(view)
result = 1

def finish(text):
    global result
    print(text, flush=True)
    result = 0 if text.startswith("passed") else 1
    Gtk.main_quit()
    return False

manager.connect("script-message-received::result", lambda _, value: finish(value.get_js_value().to_string()))
view.connect("web-process-terminated", lambda *_: finish("failed: WebKit terminated"))
window.connect("destroy", lambda *_: finish("failed: window closed"))
window.show_all()
script = """<!doctype html><video muted controls width="300" height="160"></video><script>
const v=document.querySelector('video'), a=new Audio();
a.volume=0;
const done=s=>window.webkit.messageHandlers.result.postMessage(s);
v.onerror=()=>done('failed: video decode '+v.error.code);
a.onerror=()=>done('failed: audio decode '+a.error.code);
let ready=0, running=false;
const sync=()=>{const t=v.currentTime-.5;if(t<0){a.pause();return;}if(a.readyState>=1&&Math.abs(a.currentTime-t)>.1)a.currentTime=t;if(!v.paused&&a.paused)a.play().catch(e=>done('failed: audio play '+e));};
const start=()=>{if(++ready<2)return;v.currentTime=.8;v.play().then(()=>{running=true;sync();}).catch(e=>done('failed: video play '+e));};
v.onloadedmetadata=start;a.onloadedmetadata=start;
v.onplay=sync;v.onseeking=sync;
v.ontimeupdate=()=>{sync();if(running&&v.currentTime>1.6){const delta=Math.abs(a.currentTime-(v.currentTime-.5));if(!a.paused&&delta<.2&&v.videoWidth>0){v.pause();a.pause();done('passed: '+v.videoWidth+'x'+v.videoHeight+'; independent audio offset 500ms; clock delta '+delta.toFixed(3)+'s');}}};
v.src=VIDEO_URL;a.src=AUDIO_URL;
</script>""".replace("VIDEO_URL", json.dumps(sys.argv[1])).replace("AUDIO_URL", json.dumps(sys.argv[2]))
view.load_html(script, "tauri://localhost/")
GLib.timeout_add_seconds(20, lambda: finish("failed: timeline playback timed out"))
Gtk.main()
sys.exit(result)
