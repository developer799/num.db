const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const querystring = require('querystring');
const app = express();
const port = 3000;

// 데이터베이스 설정
const db = new sqlite3.Database(':memory:');

db.serialize(() => {
  db.run("CREATE TABLE queue (id INTEGER PRIMARY KEY, phone TEXT)");
  db.run("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)");
  db.run("CREATE TABLE users (id TEXT PRIMARY KEY, access_token TEXT)");
});

app.use(bodyParser.json());
app.use(express.static('public'));

// 카카오톡 메시지 전송 함수
async function sendKakaoMessage(userId, message) {
  const user = await new Promise((resolve, reject) => {
    db.get("SELECT access_token FROM users WHERE id = ?", [userId], (err, row) => {
      if (err) {
        return reject(err);
      }
      resolve(row);
    });
  });

  if (!user) {
    console.error('User not found');
    return;
  }

  const url = 'https://kapi.kakao.com/v2/api/talk/memo/default/send';

  try {
    const templateObject = {
      object_type: 'text',
      text: message,
      link: {
        web_url: 'http://yourwebsite.com',
        mobile_web_url: 'http://yourwebsite.com'
      }
    };

    const response = await axios.post(url, querystring.stringify({
      template_object: JSON.stringify(templateObject)
    }), {
      headers: {
        'Authorization': `Bearer ${user.access_token}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    console.log('Message sent:', response.data);
  } catch (error) {
    console.error('Error sending message:', error.response ? error.response.data : error.message);
  }
}

// 대기번호 추가
app.post('/add', (req, res) => {
  const { phone, userId } = req.body;
  db.run("INSERT INTO queue (phone, user_id) VALUES (?, ?)", [phone, userId], function(err) {
    if (err) {
      return res.status(500).send(err.message);
    }
    res.send({ id: this.lastID });
    sendKakaoMessage(userId, `대기번호 ${this.lastID}번입니다.`);
  });
});

// 다음 팀 알림 및 제거
app.post('/next', (req, res) => {
  db.get("SELECT * FROM queue ORDER BY id LIMIT 1", (err, row) => {
    if (err) {
      return res.status(500).send(err.message);
    }
    if (!row) {
      return res.status(404).send('No more teams in queue');
    }
    db.run("DELETE FROM queue WHERE id = ?", [row.id], (err) => {
      if (err) {
        return res.status(500).send(err.message);
      }
      res.send(row);
      sendKakaoMessage(row.user_id, '입장하시면 됩니다.');
    });
  });
});

// 배경 이미지 설정
app.post('/background', (req, res) => {
  const { image } = req.body;
  db.run("REPLACE INTO settings (key, value) VALUES ('background', ?)", [image], (err) => {
    if (err) {
      return res.status(500).send(err.message);
    }
    res.send({ success: true });
  });
});

// 배경 이미지 가져오기
app.get('/background', (req, res) => {
  db.get("SELECT value FROM settings WHERE key = 'background'", (err, row) => {
    if (err) {
      return res.status(500).send(err.message);
    }
    res.send(row || {});
  });
});

// OAuth 콜백
app.get('/oauth', async (req, res) => {
  const { code } = req.query;
  const tokenUrl = 'https://kauth.kakao.com/oauth/token';
  const redirectUri = 'http://localhost:3000/oauth';

  try {
    const response = await axios.post(tokenUrl, querystring.stringify({
      grant_type: 'authorization_code',
      client_id: '494981ff40cdfb0242c59fa36d4308c0', // 카카오 디벨로퍼스에서 발급받은 REST API 키를 입력하세요
      redirect_uri: redirectUri,
      code
    }), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const { access_token, refresh_token } = response.data;

    // 사용자 정보를 가져옵니다
    const userResponse = await axios.get('https://kapi.kakao.com/v2/user/me', {
      headers: {
        'Authorization': `Bearer ${access_token}`
      }
    });

    const userId = userResponse.data.id.toString();
    db.run("REPLACE INTO users (id, access_token) VALUES (?, ?)", [userId, access_token], (err) => {
      if (err) {
        return res.status(500).send(err.message);
      }
      res.redirect(`/index.html?userId=${userId}`);
    });
  } catch (error) {
    console.error('Error getting OAuth token:', error.response ? error.response.data : error.message);
    res.status(500).send('Error getting OAuth token');
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
