#!/usr/bin/env python3
"""Play a small generated MP4 through the same WebKitGTK engine as Reelio."""
import base64
import sys
from pathlib import Path

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

payload = Path(sys.argv[1]).read_bytes()
if len(payload) > 1024 * 1024:
    raise SystemExit("Use a synthetic MP4 smaller than 1 MiB")
result = 1
window = Gtk.Window(title="Reelio native preview verification")
window.set_default_size(320, 200)
manager = WebKit2.UserContentManager()
manager.register_script_message_handler("result")
view = WebKit2.WebView.new_with_user_content_manager(manager)
view.get_settings().set_property("media-playback-requires-user-gesture", False)


def finish(message):
    global result
    print(message, flush=True)
    result = 0 if message == "passed" else 1
    Gtk.main_quit()
    return False


manager.connect("script-message-received::result", lambda _, value: finish(value.get_js_value().to_string()))
view.connect("web-process-terminated", lambda *_: finish("failed: WebKit process terminated"))
window.connect("destroy", lambda *_: finish("failed: window closed"))
window.add(view)
window.show_all()
uri = "data:video/mp4;base64," + base64.b64encode(payload).decode("ascii")
view.load_html("""<!doctype html><video width="300" height="160" controls></video><script>
const v=document.querySelector('video');v.volume=0;
let activeCue=false;
v.onloadedmetadata=()=>{const t=v.addTextTrack('subtitles','Test subtitle','und');t.addCue(new VTTCue(.2,1.5,'Native subtitle fixture'));t.mode='showing';t.oncuechange=()=>{if(t.activeCues.length)activeCue=true;};};
v.onended=()=>window.webkit.messageHandlers.result.postMessage(activeCue?'passed':'failed: no active subtitle cue');
v.onerror=()=>window.webkit.messageHandlers.result.postMessage('failed: media error '+v.error.code);
v.oncanplay=()=>v.play().catch(e=>window.webkit.messageHandlers.result.postMessage('failed: '+e.message));
v.src='""" + uri + "';</script>", "file:///")
GLib.timeout_add_seconds(15, lambda: finish("failed: preview timed out"))
Gtk.main()
sys.exit(result)
