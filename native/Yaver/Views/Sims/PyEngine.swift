// Code tracer (twin of js/sims/trace.js): runs the lesson's Python example with
// Pyodide inside a hidden web view (the engine only: everything you see is native),
// records every line it executes with the variables and printed output at that
// moment, and plays the run back on a timeline.
import SwiftUI
import WebKit

struct TraceStep: Decodable {
    var line: Int
    var fn: String?
    var depth: Int?
    var vars: [String: String]?
    var out: String?
    var ret: String?
    var err = false
    var done = false
    enum CodingKeys: String, CodingKey { case line, fn, depth, vars, out, ret }
}
struct TraceRun: Decodable { var steps: [TraceStep]; var error: String?; var out: String }

/// Pyodide in an offscreen WKWebView, loaded on the first trace and kept for the session.
@MainActor final class PyEngine: NSObject, WKNavigationDelegate {
    static let shared = PyEngine()
    private var web: WKWebView?
    private var ready: Task<Void, Error>?
    static let base = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/"
    static let tracer = #"""

import sys, io, json, types
def __yaver_trace(src, inputs):
    steps, out, err = [], io.StringIO(), None
    feed = iter(inputs)
    def fake_input(prompt=''):
        v = next(feed, '3')
        out.write(str(prompt) + v + '\n')
        return v
    def fake_print(*a, **k):
        k.pop('file', None)
        print(*a, file=out, **k)
    g = {'__name__': '__main__', 'input': fake_input, 'print': fake_print}
    hide = set(g)
    def show(v):
        r = repr(v)
        return r if len(r) <= 44 else r[:41] + '...'
    def snap(frame):
        res = {}
        for k, v in list(frame.f_locals.items()):
            if k.startswith('__') or k in hide: continue
            if isinstance(v, (types.ModuleType, types.FunctionType, type)): continue
            res[k] = show(v)
        return res
    def depth(frame):
        d = 0
        while frame and frame.f_code.co_filename == '<lesson>':
            d += 1; frame = frame.f_back
        return d
    def tr(frame, event, arg):
        if frame.f_code.co_filename != '<lesson>': return None
        if event in ('line', 'return'):
            if len(steps) >= 400: raise RuntimeError('stopped after 400 steps')
            st = {'line': frame.f_lineno, 'ev': event, 'fn': frame.f_code.co_name, 'depth': depth(frame), 'vars': snap(frame), 'out': out.getvalue()}
            if event == 'return' and frame.f_code.co_name != '<module>': st['ret'] = show(arg)
            if event == 'line' or st.get('ret') is not None: steps.append(st)
        return tr
    try:
        code = compile(src, '<lesson>', 'exec')
        sys.settrace(tr)
        exec(code, g)
    except BaseException as e:
        err = type(e).__name__ + ': ' + str(e)
    finally:
        sys.settrace(None)
    return json.dumps({'steps': steps, 'error': err, 'out': out.getvalue()})

"""#

    private func load() -> Task<Void, Error> {
        if let ready { return ready }
        let t = Task { @MainActor in
            let cfg = WKWebViewConfiguration()
            let w = WKWebView(frame: CGRect(x: 0, y: 0, width: 4, height: 4), configuration: cfg)
            self.web = w
            w.loadHTMLString("<!doctype html><meta charset=utf-8><script src='\(Self.base)pyodide.js'></script>", baseURL: URL(string: Self.base))
            // wait for the script to arrive
            for _ in 0..<120 {
                try await Task.sleep(nanoseconds: 250_000_000)
                if (try? await w.evaluateJavaScript("typeof loadPyodide")) as? String == "function" { break }
            }
            let js = "window.py = await loadPyodide({ indexURL: base }); await window.py.runPythonAsync(tracer); return 'ok';"
            _ = try await w.callAsyncJavaScript(js, arguments: ["base": Self.base, "tracer": Self.tracer], contentWorld: .page)
        }
        ready = t
        return t
    }

    func trace(_ src: String, inputs: [String]) async throws -> TraceRun {
        do { try await load().value } catch { ready = nil; web = nil; throw AIError(message: "Python could not be downloaded. Check the connection and try again.") }
        guard let w = web else { throw AIError(message: "Python is not ready.") }
        let js = """
        try { await window.py.loadPackagesFromImports(src) } catch (e) {}
        const fn = window.py.globals.get('__yaver_trace');
        const res = fn(src, window.py.toPy(inputs));
        fn.destroy && fn.destroy();
        return res;
        """
        let res = try await w.callAsyncJavaScript(js, arguments: ["src": src, "inputs": inputs], contentWorld: .page)
        guard let s = res as? String, let d = s.data(using: .utf8) else { throw AIError(message: "The tracer returned nothing.") }
        return try JSONDecoder().decode(TraceRun.self, from: d)
    }
}
