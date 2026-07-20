const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'data');

// 데이터 디렉토리 초기화
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

app.use(express.json({ limit: '10mb' }));

// JSON 파일 읽기 헬퍼
const readJson = (filename) => {
    const filepath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filepath)) return null;
    try {
        return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    } catch {
        return null;
    }
};

// JSON 파일 쓰기 헬퍼
const writeJson = (filename, data) => {
    const filepath = path.join(DATA_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(data), 'utf-8');
};

// ── 프로젝트 데이터 ──────────────────────────────────
app.get('/api/data', (req, res) => {
    const data = readJson('data.json');
    res.json({ ok: true, data });
});

app.post('/api/data', (req, res) => {
    writeJson('data.json', req.body);
    res.json({ ok: true });
});

// ── 설정 ─────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
    const data = readJson('settings.json');
    res.json({ ok: true, data });
});

app.post('/api/settings', (req, res) => {
    writeJson('settings.json', req.body);
    res.json({ ok: true });
});

// ── 스냅샷 ───────────────────────────────────────────
app.get('/api/snapshots', (req, res) => {
    const data = readJson('snapshots.json') || [];
    res.json({ ok: true, data });
});

app.post('/api/snapshots', (req, res) => {
    const { name, data } = req.body;
    const snapshots = readJson('snapshots.json') || [];
    const newSnapshot = {
        id: Date.now().toString(),
        name,
        date: new Date().toISOString(),
        data,
    };
    snapshots.unshift(newSnapshot);
    writeJson('snapshots.json', snapshots);
    res.json({ ok: true, snapshot: newSnapshot });
});

app.put('/api/snapshots/:id', (req, res) => {
    const { id } = req.params;
    const { data } = req.body;
    const snapshots = readJson('snapshots.json') || [];
    const index = snapshots.findIndex(s => s.id === id);
    if (index === -1) return res.status(404).json({ ok: false, error: 'Not found' });

    const updated = { ...snapshots[index], date: new Date().toISOString(), data };
    snapshots.splice(index, 1);
    snapshots.unshift(updated);
    writeJson('snapshots.json', snapshots);
    res.json({ ok: true });
});

app.delete('/api/snapshots/:id', (req, res) => {
    const { id } = req.params;
    const snapshots = readJson('snapshots.json') || [];
    writeJson('snapshots.json', snapshots.filter(s => s.id !== id));
    res.json({ ok: true });
});

// ── 헬스체크 ─────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`API server running on port ${PORT}`);
});
