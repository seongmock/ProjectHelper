# Internal HTTPS Setup Guide (Caddy) 🏢

For internal networks where you cannot use a public domain, we use **Caddy** to automatically handle Self-Signed HTTPS.

## 1. Setup
1. Open `Caddyfile` in the project root.
2. Replace `10.178.21.120` with your actual **Server IP** in both blocks.

```caddy
http://YOUR.IP.HERE:80 {
    redir https://YOUR.IP.HERE{uri}
}

https://YOUR.IP.HERE:443 {
    tls internal
    reverse_proxy project-management-app:80
}
```

## 2. Run
```bash
./start_https.sh
```

## 3. Connect
1. Open Chrome/Edge.
2. Go to `https://YOUR.IP.HERE`
3. You will see a "Your connection is not private" warning.
4. Click **Advanced** -> **Proceed to... (unsafe)**.
5. Done! Clipboard copy and other HTTPS features will work 100%.
