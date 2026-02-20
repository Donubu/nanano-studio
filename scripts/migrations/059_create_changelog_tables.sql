-- Changelog tables for showing release notes to users

CREATE TABLE IF NOT EXISTS changelogs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    version VARCHAR(20) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    image_url VARCHAR(500) NULL,
    published_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_changelog_seen (
    user_id INT NOT NULL,
    changelog_id INT NOT NULL,
    seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, changelog_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (changelog_id) REFERENCES changelogs(id) ON DELETE CASCADE
);

-- First changelog entry
INSERT INTO changelogs (version, title, content, image_url) VALUES (
    '3.3.0',
    'Novedades de Puerto.studio',
    '<ul>
<li><strong>Reintentos automáticos</strong> — Si una generación falla, el sistema reintenta automáticamente hasta 3 veces antes de mostrar un error.</li>
<li>🖼️✨ <strong>Multi-imagen en chat</strong> — ¡Ahora puedes adjuntar múltiples imágenes de referencia en una sola conversación de texto!</li>
<li><strong>Chirp 3 HD</strong> — Nuevo motor de voz de alta definición con soporte para múltiples idiomas y control de velocidad.</li>
<li><strong>Gemini 2.5 Pro</strong> — Modelo de texto actualizado con mejor razonamiento y respuestas más precisas.</li>
</ul>',
    'https://static.puer.to/nanano/generated/36_1771550534914_ss5j8i.png'
);
