"""Loopback-proxied, local Linux research service. No recording persistence."""
import base64
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
import numpy as np
from cancel import clean

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != '/api/clean':
            self.send_error(404); return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length < 80_000_000: raise ValueError('Invalid recording size')
            data = json.loads(self.rfile.read(length))
            sr = int(data['sampleRate'])
            if sr not in (24000, 44100, 48000, 96000): raise ValueError('Unsupported sample rate')
            channels = [np.frombuffer(base64.b64decode(data[k], validate=True), dtype='<f4').astype(float)
                        for k in ('mic', 'left', 'right')]
            if len({len(c) for c in channels}) != 1 or not 1 < len(channels[0]) <= sr*120:
                raise ValueError('Mismatched channels or recording longer than two minutes')
            if any(not np.isfinite(c).all() for c in channels): raise ValueError('Nonfinite samples')
            cal, tail = float(data['calibrationEnd']), float(data['tailStart'])
            duration = len(channels[0])/sr
            if not 3 <= cal < tail < duration-2: raise ValueError('Invalid calibration regions')
            cleaned, metrics = clean(channels[0], np.stack(channels[1:], axis=1), sr, cal, tail)
            body = json.dumps(dict(metrics=metrics, cleaned=base64.b64encode(cleaned.astype('<f4').tobytes()).decode())).encode()
            self.send_response(200); self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
        except Exception as exc:
            self.send_error(400, str(exc))

if __name__ == '__main__':
    import os
    if not os.path.exists('/.dockerenv'): raise RuntimeError('Run only in the Linux research sandbox')
    HTTPServer(('0.0.0.0', 8766), Handler).serve_forever()
