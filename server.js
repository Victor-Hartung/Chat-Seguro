const express = require('express');
const { Server } = require('ws');
const path = require('path');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do multer para upload de arquivos
const upload = multer({ dest: 'uploads/' });

// Servir arquivos de upload
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Rota para upload de arquivos
app.post('/upload', upload.single('file'), (req, res) => {
    const fileUrl = `http://192.168.3.122:${PORT}/uploads/${req.file.filename}`;
    res.json({ fileUrl, fileName: req.file.originalname });
});

// Servir arquivos estáticos da pasta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Conectar ao banco de dados SQLite
const db = new sqlite3.Database('./chat.db', (err) => {
    if (err) {
        console.error('Erro ao abrir o banco de dados:', err.message);
        process.exit(1);
    } else {
        console.log('Conectado ao banco de dados SQLite.');
    }
});

// Função para criar tabelas e verificar a estrutura
function initializeDatabase() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run(`
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId TEXT UNIQUE,
                    fullId TEXT UNIQUE,
                    username TEXT NOT NULL,
                    password TEXT NOT NULL
                )
            `, (err) => {
                if (err) reject(err);
                else console.log('Tabela users criada ou já existe.');
            });

            db.run(`
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    roomId TEXT NOT NULL,
                    sender TEXT NOT NULL,
                    text TEXT,
                    fileUrl TEXT,
                    fileName TEXT,
                    timestamp INTEGER NOT NULL,
                    replyTo INTEGER,
                    delivered INTEGER DEFAULT 0,
                    read INTEGER DEFAULT 0,
                    deleted INTEGER DEFAULT 0
                )
            `, (err) => {
                if (err) reject(err);
                else console.log('Tabela messages criada ou já existe.');
            });

            db.run(`
                CREATE TABLE IF NOT EXISTS contacts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userFullId TEXT NOT NULL,
                    contactFullId TEXT NOT NULL,
                    alias TEXT,
                    UNIQUE(userFullId, contactFullId),
                    FOREIGN KEY(userFullId) REFERENCES users(fullId),
                    FOREIGN KEY(contactFullId) REFERENCES users(fullId)
                )
            `, (err) => {
                if (err) reject(err);
                else console.log('Tabela contacts criada ou já existe.');
            });

            db.all(`PRAGMA table_info(users)`, (err, rows) => {
                if (err) reject(err);
                else {
                    console.log('Estrutura da tabela users:', rows);
                    resolve();
                }
            });
        });
    });
}

// Iniciar o servidor após inicializar o banco
initializeDatabase()
    .then(() => {
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`Servidor rodando em http://192.168.3.122:${PORT}`);
        });

        const wss = new Server({ server });
        const clients = new Map();

        function generateCode() {
            return Math.floor(1000 + Math.random() * 9000).toString();
        }

        function generateRoomId(user1, user2) {
            return [user1, user2].sort().join('-');
        }

        function loadMessages(roomId, callback) {
            db.all(
                `SELECT * FROM messages WHERE roomId = ? ORDER BY timestamp ASC`,
                [roomId],
                (err, rows) => {
                    if (err) {
                        console.error('Erro ao carregar mensagens:', err.message);
                        callback([]);
                    } else {
                        callback(rows.map(row => ({
                            type: row.fileUrl ? 'file' : 'message',
                            fromFullId: row.sender,
                            message: row.text || null,
                            fileUrl: row.fileUrl || null,
                            fileName: row.fileName || null,
                            timestamp: row.timestamp,
                            replyTo: row.replyTo || null,
                            sent: true,
                            delivered: !!row.delivered,
                            read: !!row.read,
                            deleted: !!row.deleted
                        })));
                    }
                }
            );
        }

        function loadMessagesForUser(fullId, callback) {
            db.all(
                `SELECT * FROM messages WHERE roomId LIKE ? OR roomId LIKE ? ORDER BY timestamp ASC`,
                [`${fullId}-%`, `%-${fullId}`],
                (err, rows) => {
                    if (err) {
                        console.error('Erro ao carregar mensagens do usuário:', err.message);
                        callback({});
                        return;
                    }
                    const messagesByRoom = {};
                    rows.forEach(row => {
                        if (!messagesByRoom[row.roomId]) messagesByRoom[row.roomId] = [];
                        messagesByRoom[row.roomId].push({
                            type: row.fileUrl ? 'file' : 'message',
                            fromFullId: row.sender,
                            message: row.text || null,
                            fileUrl: row.fileUrl || null,
                            fileName: row.fileName || null,
                            timestamp: row.timestamp,
                            replyTo: row.replyTo || null,
                            sent: row.sender === fullId,
                            delivered: !!row.delivered,
                            read: !!row.read,
                            deleted: !!row.deleted
                        });
                    });
                    callback(messagesByRoom);
                }
            );
        }

        function loadContacts(fullId, callback) {
            db.all(
                `SELECT contactFullId, alias FROM contacts WHERE userFullId = ?`,
                [fullId],
                (err, rows) => {
                    if (err) {
                        console.error('Erro ao carregar contatos:', err.message);
                        callback([]);
                    } else {
                        callback(rows.map(row => ({
                            fullId: row.contactFullId,
                            alias: row.alias || row.contactFullId.split('#')[0]
                        })));
                    }
                }
            );
        }

        function addContact(userFullId, contactFullId, alias, callback) {
            db.run(
                `INSERT OR IGNORE INTO contacts (userFullId, contactFullId, alias) VALUES (?, ?, ?)`,
                [userFullId, contactFullId, alias || contactFullId.split('#')[0]],
                (err) => {
                    if (err) console.error('Erro ao adicionar contato:', err.message);
                    callback(err);
                }
            );
        }

        function updateAlias(userFullId, contactFullId, alias, callback) {
            db.run(
                `UPDATE contacts SET alias = ? WHERE userFullId = ? AND contactFullId = ?`,
                [alias, userFullId, contactFullId],
                (err) => {
                    if (err) {
                        console.error('Erro ao atualizar apelido:', err.message);
                        callback(err);
                    } else {
                        console.log(`Apelido atualizado para ${alias} para ${contactFullId} por ${userFullId}`);
                        callback(null);
                    }
                }
            );
        }

        function notifyDelivered(senderFullId, roomId, messageId) {
            const sender = clients.get(senderFullId);
            if (sender && sender.readyState === WebSocket.OPEN) {
                sender.send(JSON.stringify({ type: 'delivered', messageId }));
                console.log(`Notificação 'delivered' enviada para ${senderFullId} sobre mensagem ${messageId} em ${roomId}`);
            } else {
                console.log(`Remetente ${senderFullId} não está online para receber notificação 'delivered' da mensagem ${messageId}`);
            }
        }

        wss.on('connection', (ws) => {
            console.log('Novo cliente conectado');

            ws.on('message', (message) => {
                let data;
                try {
                    data = JSON.parse(message);
                    console.log('Mensagem recebida:', data);
                } catch (e) {
                    console.error('Erro ao parsear mensagem:', e.message);
                    return;
                }

                if (data.type === 'register') {
                    const { id, username, password } = data;
                    const fullId = `${username}#${generateCode()}`;
                    db.get(`SELECT * FROM users WHERE userId = ?`, [id], (err, row) => {
                        if (err) {
                            ws.send(JSON.stringify({ type: 'auth_fail', message: 'Erro no servidor' }));
                            return;
                        }
                        if (row) {
                            ws.send(JSON.stringify({ type: 'auth_fail', message: 'Usuário já registrado!' }));
                            return;
                        }
                        db.run(
                            `INSERT INTO users (userId, fullId, username, password) VALUES (?, ?, ?, ?)`,
                            [id, fullId, username, password],
                            (err) => {
                                if (err) {
                                    ws.send(JSON.stringify({ type: 'auth_fail', message: 'Erro ao registrar' }));
                                    return;
                                }
                                ws.fullId = fullId;
                                clients.set(fullId, ws);
                                ws.send(JSON.stringify({ type: 'auth_success', fullId, contacts: [], messages: {} }));
                                console.log(`Novo usuário registrado: ${fullId}`);
                            }
                        );
                    });
                }

                if (data.type === 'login') {
                    const { id, password } = data;
                    db.get(`SELECT * FROM users WHERE userId = ? AND password = ?`, [id, password], (err, row) => {
                        if (err) {
                            ws.send(JSON.stringify({ type: 'auth_fail', message: 'Erro no servidor' }));
                            return;
                        }
                        if (!row) {
                            ws.send(JSON.stringify({ type: 'auth_fail', message: 'Credenciais inválidas!' }));
                            return;
                        }
                        ws.fullId = row.fullId;
                        clients.set(row.fullId, ws);
                        loadContacts(row.fullId, (contacts) => {
                            loadMessagesForUser(row.fullId, (messages) => {
                                ws.send(JSON.stringify({
                                    type: 'auth_success',
                                    fullId: row.fullId,
                                    contacts,
                                    messages
                                }));
                                console.log(`Usuário conectado: ${row.fullId}`);

                                // Notificar outros usuários e verificar mensagens pendentes
                                clients.forEach((client, clientFullId) => {
                                    if (clientFullId !== row.fullId && client.readyState === WebSocket.OPEN) {
                                        client.send(JSON.stringify({ type: 'user_online', fullId: row.fullId }));
                                        db.all(
                                            `SELECT * FROM messages WHERE roomId LIKE ? OR roomId LIKE ? AND sender = ? AND delivered = 0`,
                                            [`${clientFullId}-%`, `%-${clientFullId}`, clientFullId],
                                            (err, pendingMessages) => {
                                                if (err) {
                                                    console.error('Erro ao buscar mensagens pendentes:', err.message);
                                                    return;
                                                }
                                                pendingMessages.forEach(msg => {
                                                    const recipientId = msg.roomId.split('-').find(id => id !== clientFullId);
                                                    if (recipientId === row.fullId) {
                                                        db.run(
                                                            `UPDATE messages SET delivered = 1 WHERE roomId = ? AND timestamp = ?`,
                                                            [msg.roomId, msg.timestamp],
                                                            (err) => {
                                                                if (err) {
                                                                    console.error('Erro ao marcar como entregue:', err.message);
                                                                    return;
                                                                }
                                                                console.log(`Mensagem ${msg.timestamp} de ${clientFullId} para ${row.fullId} marcada como entregue`);
                                                                notifyDelivered(clientFullId, msg.roomId, msg.timestamp);
                                                            }
                                                        );
                                                    }
                                                });
                                            }
                                        );
                                    }
                                });
                            });
                        });
                    });
                }

                if (data.type === 'add_contact') {
                    const { contactFullId, alias } = data;
                    addContact(ws.fullId, contactFullId, alias, (err) => {
                        if (!err) {
                            loadContacts(ws.fullId, (contacts) => {
                                ws.send(JSON.stringify({ type: 'contacts_updated', contacts }));
                            });
                        }
                    });
                }

                if (data.type === 'update_alias') {
                    const { contactFullId, alias, userFullId } = data;
                    updateAlias(userFullId, contactFullId, alias, (err) => {
                        if (!err) {
                            loadContacts(userFullId, (contacts) => {
                                ws.send(JSON.stringify({ type: 'contacts_updated', contacts }));
                            });
                        } else {
                            ws.send(JSON.stringify({ type: 'error', message: 'Erro ao atualizar apelido' }));
                        }
                    });
                }

                if (data.type === 'message' || data.type === 'file') {
                    const recipient = clients.get(data.toFullId);
                    const roomId = generateRoomId(ws.fullId, data.toFullId);
                    const messageData = {
                        roomId,
                        sender: ws.fullId,
                        text: data.type === 'message' ? (data.message || null) : null,
                        fileUrl: data.type === 'file' ? (data.fileUrl || null) : null,
                        fileName: data.type === 'file' ? (data.fileName || null) : null,
                        timestamp: data.timestamp,
                        replyTo: data.replyTo || null
                    };

                    db.run(
                        `INSERT INTO messages (roomId, sender, text, fileUrl, fileName, timestamp, replyTo) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [messageData.roomId, messageData.sender, messageData.text, messageData.fileUrl, messageData.fileName, messageData.timestamp, messageData.replyTo],
                        (err) => {
                            if (err) {
                                console.error('Erro ao salvar mensagem:', err.message);
                                return;
                            }
                            // Adicionar remetente como contato do destinatário se não existir
                            addContact(data.toFullId, ws.fullId, null, (err) => {
                                if (!err && clients.has(data.toFullId)) {
                                    loadContacts(data.toFullId, (contacts) => {
                                        const recipientClient = clients.get(data.toFullId);
                                        if (recipientClient && recipientClient.readyState === WebSocket.OPEN) {
                                            recipientClient.send(JSON.stringify({ type: 'contacts_updated', contacts }));
                                        }
                                    });
                                }
                            });

                            const sendData = {
                                type: data.type,
                                fromFullId: ws.fullId,
                                message: messageData.text,
                                fileUrl: messageData.fileUrl,
                                fileName: messageData.fileName,
                                timestamp: messageData.timestamp,
                                replyTo: messageData.replyTo,
                                sent: true,
                                delivered: recipient && recipient.readyState === WebSocket.OPEN ? true : false,
                                read: false,
                                deleted: false
                            };

                            if (recipient && recipient.readyState === WebSocket.OPEN) {
                                recipient.send(JSON.stringify(sendData));
                                db.run(
                                    `UPDATE messages SET delivered = 1 WHERE roomId = ? AND timestamp = ?`,
                                    [roomId, data.timestamp],
                                    (err) => {
                                        if (err) console.error('Erro ao marcar como entregue:', err.message);
                                        console.log(`Mensagem ${data.timestamp} marcada como entregue ao enviar para ${data.toFullId}`);
                                        notifyDelivered(ws.fullId, roomId, data.timestamp);
                                    }
                                );
                            } else {
                                console.log(`Mensagem ${data.timestamp} enviada, mas ${data.toFullId} está offline. Aguardando entrega.`);
                            }
                        }
                    );
                }

                if (data.type === 'delete') {
                    const recipient = clients.get(data.contact);
                    const roomId = data.roomId;
                    db.run(
                        `UPDATE messages SET deleted = 1, text = NULL, fileUrl = NULL, fileName = NULL WHERE roomId = ? AND timestamp = ? AND sender = ?`,
                        [roomId, data.timestamp, ws.fullId],
                        (err) => {
                            if (err) {
                                console.error('Erro ao deletar mensagem:', err.message);
                                return;
                            }
                            if (recipient && recipient.readyState === WebSocket.OPEN) {
                                recipient.send(JSON.stringify({ type: 'delete', roomId, timestamp: data.timestamp }));
                            }
                        }
                    );
                }

                if (data.type === 'delivered') {
                    const roomId = generateRoomId(ws.fullId, data.contact);
                    db.run(
                        `UPDATE messages SET delivered = 1 WHERE roomId = ? AND timestamp = ?`,
                        [roomId, data.messageId],
                        (err) => {
                            if (err) {
                                console.error('Erro ao marcar como entregue:', err.message);
                                return;
                            }
                            console.log(`Mensagem ${data.messageId} confirmada como entregue por ${ws.fullId}`);
                            notifyDelivered(data.contact, roomId, data.messageId);
                        }
                    );
                }

                if (data.type === 'read') {
                    const recipient = clients.get(data.contact);
                    const roomId = generateRoomId(ws.fullId, data.contact);
                    db.run(
                        `UPDATE messages SET read = 1, delivered = 1 WHERE roomId = ? AND timestamp = ?`,
                        [roomId, data.messageId],
                        (err) => {
                            if (err) {
                                console.error('Erro ao marcar como lido:', err.message);
                                return;
                            }
                            console.log(`Mensagem ${data.messageId} marcada como lida por ${ws.fullId}`);
                            if (recipient && recipient.readyState === WebSocket.OPEN) {
                                recipient.send(JSON.stringify({ type: 'read', messageId: data.messageId }));
                            }
                        }
                    );
                }

                if (data.type === 'request_status_update') {
                    const fullId = data.fullId;
                    db.all(
                        `SELECT * FROM messages WHERE roomId LIKE ? OR roomId LIKE ? AND sender = ? AND delivered = 0`,
                        [`${fullId}-%`, `%-${fullId}`, fullId],
                        (err, pendingMessages) => {
                            if (err) {
                                console.error('Erro ao buscar mensagens pendentes para atualização de status:', err.message);
                                return;
                            }
                            pendingMessages.forEach(msg => {
                                const recipientId = msg.roomId.split('-').find(id => id !== fullId);
                                const recipient = clients.get(recipientId);
                                if (recipient && recipient.readyState === WebSocket.OPEN) {
                                    db.run(
                                        `UPDATE messages SET delivered = 1 WHERE roomId = ? AND timestamp = ?`,
                                        [msg.roomId, msg.timestamp],
                                        (err) => {
                                            if (err) console.error('Erro ao marcar como entregue:', err.message);
                                            console.log(`Mensagem ${msg.timestamp} de ${fullId} para ${recipientId} marcada como entregue (status update)`);
                                            notifyDelivered(fullId, msg.roomId, msg.timestamp);
                                        }
                                    );
                                }
                            });
                        }
                    );
                }

                if (data.type === 'typing') {
                    const recipient = clients.get(data.contactFullId);
                    if (recipient && recipient.readyState === WebSocket.OPEN) {
                        recipient.send(JSON.stringify({ type: 'typing', fromFullId: ws.fullId }));
                    }
                }
            });

            ws.on('close', () => {
                if (ws.fullId) {
                    clients.delete(ws.fullId);
                    console.log(`Cliente ${ws.fullId} desconectado`);
                }
            });
        });

        console.log('Servidor WebSocket iniciado');
    })
    .catch((err) => {
        console.error('Erro ao inicializar o banco de dados:', err.message);
        process.exit(1);
    });