#!/usr/bin/env python3
"""Qualify React Timeline/PreviewTransport in WebKitGTK with owned Wayland drags.

Start Vite on a private loopback port and pass /native-tests/timeline.html or
/native-tests/transport.html. The latter generates an owned H.264 fixture and
checks real paused decoded frames after forward/backward physical scrubbing.
Requires Hyprland, GTK/WebKitGTK bindings, cc and Wayland client headers. No user
media, application database or current Reelio window is accessed.
"""
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import threading
from urllib.parse import urlsplit, urlencode
import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

url = urlsplit(sys.argv[1])
if url.scheme != "http" or url.hostname != "127.0.0.1" or url.path not in ("/native-tests/timeline.html", "/native-tests/transport.html"):
    raise SystemExit("Expected owned loopback native timeline or transport harness")
root = Path(__file__).resolve().parent
scratch = tempfile.TemporaryDirectory(prefix="reelio-native-editor-")
driver = Path(scratch.name) / "pointer-drag"
flags = shlex.split(subprocess.check_output(["pkg-config", "--cflags", "--libs", "wayland-client"], text=True))
subprocess.run(["cc", str(root / "native-pointer-drag.c"), *flags, "-o", str(driver)], check=True)
manager = WebKit2.UserContentManager()
manager.register_script_message_handler("result")
context = WebKit2.WebContext.new_ephemeral()
view = WebKit2.WebView(web_context=context, user_content_manager=manager)
window = Gtk.Window(title="Reelio owned native editor regression")
window.set_decorated(False)
window.set_default_size(1100, 700)
window.add(view)
result = 1
finished = False

def finish(ok, detail):
    global result, finished
    if finished:
        return False
    finished = True
    result = 0 if ok else 1
    print(json.dumps({"passed": ok, "detail": detail}), flush=True)
    Gtk.main_quit()
    return False

def run_js(source):
    view.evaluate_javascript(source + ".catch(error => window.webkit.messageHandlers.result.postMessage(JSON.stringify({kind:'failed',message:String(error)+' '+String(error.stack||'')})))", -1, None, None, None, None, None)
    return False

def drag(message):
    try:
        clients = json.loads(subprocess.check_output(["hyprctl", "-j", "clients"]))
        owned = [w for w in clients if w.get("pid") == os.getpid() and w.get("title") == "Reelio owned native editor regression"]
        if len(owned) != 1:
            raise RuntimeError("Owned test window is not uniquely identified")
        w = owned[0]
        subprocess.run(["hyprctl", "dispatch", f'hl.dsp.focus({{window="address:{w["address"]}"}})'], check=True)
        monitors = json.loads(subprocess.check_output(["hyprctl", "-j", "monitors"]))
        left = min(m["x"] for m in monitors)
        top = min(m["y"] for m in monitors)
        width = round(max(m["x"] + m["width"] / m["scale"] for m in monitors) - left)
        height = round(max(m["y"] + m["height"] / m["scale"] for m in monitors) - top)
        print(json.dumps({"owned_window": {key:w[key] for key in ("at", "size", "pid")}, "input": message}), flush=True)
        ratio = message["native_width"] / message["innerWidth"]
        coordinates = [round(w["at"][0] + message["start"][0] * ratio), round(w["at"][1] + message["start"][1] * ratio), round(w["at"][0] + message["end"][0] * ratio), round(w["at"][1] + message["end"][1] * ratio)]
        subprocess.run([str(driver), *map(str, coordinates + [left, top, width, height, os.getpid()])], check=True)
        GLib.idle_add(run_js, f'window.checkNativeDrag({json.dumps(message["tiny"])})')
    except Exception as error:
        GLib.idle_add(finish, False, str(error))

def message_received(_, value):
    try:
        message = json.loads(value.get_js_value().to_string())
        print(json.dumps(message), flush=True)
        if message["kind"] == "ready":
            run_js("window.prepareNativeDrag(false)")
        elif message["kind"] == "drag":
            message["native_width"] = view.get_allocated_width()
            threading.Thread(target=drag, args=(message,), daemon=True).start()
        elif message["kind"] in ("passed", "failed"):
            finish(message["kind"] == "passed", message)
    except Exception as error:
        finish(False, str(error))

manager.connect("script-message-received::result", message_received)
view.connect("web-process-terminated", lambda *_: finish(False, "WebKit process terminated"))
window.connect("destroy", lambda *_: finish(False, "Owned test window closed"))
window.show_all()
fixture = None
page_url = sys.argv[1]
if url.path == "/native-tests/transport.html":
    fixture = tempfile.NamedTemporaryFile(prefix="transport-", suffix=".mp4", dir=root.parent / "apps/desktop/native-tests")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=8", "-an", "-c:v", "libx264", "-preset", "ultrafast", "-g", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", fixture.name], check=True)
    page_url += "?" + urlencode({"media": "/native-tests/" + Path(fixture.name).name, "fps": "30/1"})
view.load_uri(page_url)
GLib.timeout_add_seconds(60, lambda: finish(False, "Native editor regression timed out"))
Gtk.main()
window.destroy()
scratch.cleanup()
if fixture is not None:
    fixture.close()
sys.exit(result)
