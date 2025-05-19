const ws = new WebSocket('ws://192.168.3.122:3000');
let myFullId = null;
let contacts = [];
let currentRoom = null;
const encryptionKey = 'chave_secreta_123';
const roomMessages = new Map();
let replyingTo = null;

const emojis = [
    '😊', '😂', '😍', '😢', '😡', '👍', '👎', '🙌', '🎉', '💪',
    '✨', '🔥', '🌟', '❤️', '💔', '💬', '📸', '🎥', '📝', '🚀'
];

const fileOptions = [
    { name: 'Foto', accept: 'image/*' },
    { name: 'Vídeo', accept: 'video/*' },
    { name: 'PDF', accept: '.pdf' },
    { name: 'Word', accept: '.doc,.docx' },
    { name: 'PowerPoint', accept: '.ppt,.pptx' }
];

document.addEventListener('DOMContentLoaded', () => {
    loadEmojiPicker();
    loadFilePicker();
    loadMode();

    document.getElementById('auth-id').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') login();
    });
    document.getElementById('auth-username').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') register();
    });
    document.getElementById('auth-password').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') login();
    });

    document.getElementById('message-input').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') sendMessage();
    });

    document.getElementById('message-input').addEventListener('input', () => {
        if (currentRoom) {
            const contactFullId = currentRoom.split('-').find(id => id !== myFullId);
            ws.send(JSON.stringify({ type: 'typing', contactFullId }));
        }
    });

    document.getElementById('file-input').addEventListener('change', handleFileSelect);

    document.getElementById('media-modal').addEventListener('click', function(e) {
        if (e.target === this) closeModal();
    });
});

ws.onopen = () => {
    console.log('Conectado ao servidor');
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'auth_success') {
        myFullId = data.fullId;
        contacts = data.contacts || [];
        document.getElementById('my-friend-code').textContent = `Seu código de amizade: ${myFullId}`;
        document.getElementById('auth-screen').style.display = 'none';
        document.getElementById('chat-container').style.display = 'flex';
        document.getElementById('contacts-area').classList.add('visible');
        updateContactsList();
        if (data.messages) {
            roomMessages.clear();
            Object.entries(data.messages).forEach(([roomId, messages]) => {
                roomMessages.set(roomId, messages.map(msg => ({
                    ...msg,
                    sender: msg.fromFullId,
                    text: msg.message ? CryptoJS.AES.decrypt(msg.message, encryptionKey).toString(CryptoJS.enc.Utf8) : null,
                    type: msg.sent ? 'sent' : 'received',
                    delivered: msg.delivered || false,
                    read: msg.read || false
                })));
                console.log(`Mensagens carregadas para ${roomId}:`, roomMessages.get(roomId));
            });
            if (currentRoom) {
                loadRoomMessages(currentRoom);
            } else {
                document.getElementById('messages').innerHTML = '';
            }
        }
        ws.send(JSON.stringify({ type: 'request_status_update', fullId: myFullId }));
    } else if (data.type === 'auth_fail') {
        alert(data.message);
    } else if (data.type === 'message') {
        const decrypted = CryptoJS.AES.decrypt(data.message, encryptionKey).toString(CryptoJS.enc.Utf8);
        const senderFullId = data.fromFullId;
        const roomId = generateRoomId(myFullId, senderFullId);
        addMessage(decrypted, 'received', roomId, senderFullId, data.timestamp, data.replyTo);
        ws.send(JSON.stringify({ type: 'delivered', messageId: data.timestamp, contact: senderFullId }));
        if (currentRoom === roomId) {
            ws.send(JSON.stringify({ type: 'read', messageId: data.timestamp, contact: senderFullId }));
        }
    } else if (data.type === 'file') {
        const senderFullId = data.fromFullId;
        const roomId = generateRoomId(myFullId, senderFullId);
        addFileMessage(data.fileUrl, data.fileName, 'received', roomId, senderFullId, data.timestamp, data.replyTo);
        ws.send(JSON.stringify({ type: 'delivered', messageId: data.timestamp, contact: senderFullId }));
        if (currentRoom === roomId) {
            ws.send(JSON.stringify({ type: 'read', messageId: data.timestamp, contact: senderFullId }));
        }
    } else if (data.type === 'delete') {
        markMessageAsDeleted(data.roomId, data.timestamp);
    } else if (data.type === 'delivered') {
        console.log(`Notificação 'delivered' recebida para mensagem ${data.messageId}`);
        markAsDelivered(data.messageId);
    } else if (data.type === 'read') {
        markAsRead(data.messageId);
    } else if (data.type === 'typing') {
        const senderFullId = data.fromFullId;
        const roomId = generateRoomId(myFullId, senderFullId);
        if (currentRoom === roomId) {
            const typingIndicator = document.getElementById('typing-indicator') || createTypingIndicator();
            typingIndicator.style.display = 'block';
            setTimeout(() => typingIndicator.style.display = 'none', 2000);
        }
    } else if (data.type === 'contacts_updated') {
        contacts = data.contacts;
        updateContactsList();
        if (currentRoom) loadRoomMessages(currentRoom);
    } else if (data.type === 'user_online') {
        const contactFullId = data.fullId;
        const roomId = generateRoomId(myFullId, contactFullId);
        if (roomMessages.has(roomId)) {
            let updated = false;
            roomMessages.get(roomId).forEach(msg => {
                if (msg.sent && !msg.delivered) {
                    msg.delivered = true;
                    updated = true;
                    console.log(`Mensagem ${msg.timestamp} marcada como entregue (user_online)`);
                    ws.send(JSON.stringify({ type: 'delivered', messageId: msg.timestamp, contact: contactFullId }));
                }
            });
            if (updated && currentRoom === roomId) {
                console.log(`Recarregando chat ${roomId} devido a atualização de entrega`);
                loadRoomMessages(roomId);
            }
        }
    }
};

ws.onerror = (error) => {
    console.error('Erro no WebSocket:', error);
    alert('Erro ao conectar ao servidor. Verifique se o servidor está rodando.');
};

ws.onclose = () => {
    console.log('Conexão com o servidor fechada');
    alert('Conexão perdida. Tente recarregar a página.');
};

function login() {
    const id = document.getElementById('auth-id').value.trim();
    const password = document.getElementById('auth-password').value.trim();
    if (!id || !password) {
        alert('Por favor, preencha todos os campos!');
        return;
    }
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'login', id, password }));
    } else {
        alert('Não foi possível conectar ao servidor.');
    }
}

function toggleRegister() {
    const usernameInput = document.getElementById('auth-username');
    if (usernameInput.style.display === 'none') {
        usernameInput.style.display = 'block';
        document.getElementById('register-btn').textContent = 'Confirmar Registro';
        document.getElementById('register-btn').onclick = register;
    } else {
        usernameInput.style.display = 'none';
        document.getElementById('register-btn').textContent = 'Registrar';
        document.getElementById('register-btn').onclick = toggleRegister;
    }
}

function register() {
    const id = document.getElementById('auth-id').value.trim();
    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value.trim();
    if (!id || !username || !password) {
        alert('Por favor, preencha todos os campos!');
        return;
    }
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'register', id, username, password }));
    } else {
        alert('Não foi possível conectar ao servidor.');
    }
}

function logout() {
    myFullId = null;
    contacts = [];
    currentRoom = null;
    roomMessages.clear();
    document.getElementById('chat-container').style.display = 'none';
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('auth-id').value = '';
    document.getElementById('auth-username').value = '';
    document.getElementById('auth-username').style.display = 'none';
    document.getElementById('auth-password').value = '';
    document.getElementById('register-btn').textContent = 'Registrar';
    document.getElementById('register-btn').onclick = toggleRegister;
    ws.close();
    setTimeout(() => location.reload(), 100);
}

function createTypingIndicator() {
    const typingIndicator = document.createElement('span');
    typingIndicator.id = 'typing-indicator';
    typingIndicator.textContent = 'digitando...';
    document.querySelector('.chat-header').appendChild(typingIndicator);
    return typingIndicator;
}

function addContact() {
    const fullId = prompt('Digite o código de amizade (ex.: usuario#1234):');
    if (fullId && fullId !== myFullId && !contacts.some(c => c.fullId === fullId)) {
        const alias = prompt(`Dê um apelido para ${fullId} (opcional):`) || fullId.split('#')[0];
        ws.send(JSON.stringify({ type: 'add_contact', contactFullId: fullId, alias }));
    } else if (fullId === myFullId) {
        alert('Você não pode adicionar seu próprio código!');
    } else if (contacts.some(c => c.fullId === fullId)) {
        alert('Esse contato já foi adicionado!');
    }
}

function updateContactsList() {
    const contactsList = document.getElementById('contacts');
    contactsList.innerHTML = '';
    contacts.forEach(contact => {
        const li = document.createElement('li');
        li.setAttribute('data-contact', contact.fullId);
        li.onclick = (event) => {
            if (!event.target.closest('.contact-dropdown')) switchRoom(contact.fullId);
        };
        li.innerHTML = `
            <span class="contact-name">${contact.alias} (${contact.fullId})</span>
            <div class="contact-dropdown">
                <button class="contact-dropdown-btn" onclick="toggleContactDropdown(event, '${contact.fullId}')"><i class="fas fa-ellipsis-v"></i></button>
                <div class="contact-dropdown-content" id="contact-dropdown-${contact.fullId}">
                    <button onclick="deleteContact('${contact.fullId}')">Excluir</button>
                </div>
            </div>
        `;
        contactsList.appendChild(li);
    });
}

function switchRoom(contactFullId) {
    const roomId = generateRoomId(myFullId, contactFullId);
    if (currentRoom !== roomId) {
        currentRoom = roomId;
        if (!roomMessages.has(roomId)) roomMessages.set(roomId, []);
        const contact = contacts.find(c => c.fullId === contactFullId);
        document.getElementById('room-title').textContent = `${contact.alias}`;
        document.getElementById('room-subtitle').textContent = `${contact.fullId}`;
        console.log(`Abrindo chat ${roomId}. Estado atual das mensagens:`, roomMessages.get(roomId));
        loadRoomMessages(roomId);

        roomMessages.get(roomId).forEach(msg => {
            if (msg.type === 'received' && !msg.read) {
                ws.send(JSON.stringify({ type: 'read', messageId: msg.timestamp, contact: contactFullId }));
                msg.read = true;
                msg.delivered = true;
            }
        });

        const messagesDiv = document.getElementById('messages');
        const aliasButton = document.createElement('button');
        aliasButton.id = 'set-alias-btn';
        aliasButton.textContent = 'Definir Apelido';
        aliasButton.onclick = () => setAlias(contactFullId);
        messagesDiv.insertBefore(aliasButton, messagesDiv.firstChild);
    }
}

function setAlias(contactFullId) {
    const contact = contacts.find(c => c.fullId === contactFullId);
    if (contact) {
        const newAlias = prompt(`Dê um apelido para ${contact.fullId}:`, contact.alias);
        if (newAlias !== null && newAlias.trim() !== '') {
            contact.alias = newAlias.trim();
            ws.send(JSON.stringify({ 
                type: 'update_alias', 
                contactFullId: contactFullId, 
                alias: newAlias.trim(),
                userFullId: myFullId
            }));
            updateContactsList();
            if (currentRoom === generateRoomId(myFullId, contactFullId)) {
                document.getElementById('room-title').textContent = `${contact.alias}`;
                document.getElementById('room-subtitle').textContent = `${contact.fullId}`;
                loadRoomMessages(currentRoom);
            }
        }
    }
}

function generateRoomId(user1, user2) {
    return [user1, user2].sort().join('-');
}

function getDisplayName(fullId) {
    if (fullId === myFullId) {
        return myFullId.split('#')[0];
    }
    const contact = contacts.find(c => c.fullId === fullId);
    return contact ? contact.alias : fullId.split('#')[0];
}

function loadRoomMessages(roomId) {
    document.querySelectorAll('.dropdown-content.show').forEach(el => {
        el.classList.remove('show');
        el.style.top = 'auto';
        el.style.left = 'auto';
    });
    document.querySelectorAll('.dropdown-content').forEach(el => {
        if (el.id.startsWith('delete-options-')) el.style.display = 'none';
    });

    if (roomId !== currentRoom) return;

    const messages = document.getElementById('messages');
    messages.innerHTML = '';
    const savedMessages = roomMessages.get(roomId) || [];
    console.log(`Renderizando mensagens para ${roomId}:`, savedMessages);
    savedMessages.forEach(msg => {
        const div = document.createElement('div');
        div.className = `message ${msg.type} ${msg.deleted ? 'deleted' : ''} ${msg.sent && msg.new ? 'new' : ''}`;
        let content = '';
        const displayName = getDisplayName(msg.sender);
        if (msg.deleted) {
            content = 'Essa mensagem foi apagada';
        } else {
            if (msg.replyTo) {
                const repliedMsg = roomMessages.get(roomId).find(m => m.timestamp === msg.replyTo);
                if (repliedMsg && !repliedMsg.deleted) {
                    const repliedDisplayName = getDisplayName(repliedMsg.sender);
                    content += `<div class="reply-info"><strong>${repliedDisplayName}</strong>: ${repliedMsg.text || repliedMsg.fileName}</div>`;
                }
            }
            if (msg.fileUrl) {
                content += `<strong>${displayName}</strong>: `;
                if (msg.fileName.match(/\.(jpg|jpeg|png|gif)$/i)) {
                    content += `<img src="${msg.fileUrl}" alt="${msg.fileName}" style="max-width: 200px; cursor: pointer;" onclick="openModal('${msg.fileUrl}', 'image', '${msg.fileName}')">`;
                } else if (msg.fileName.match(/\.(mp4|webm|ogg)$/i)) {
                    content += `<video src="${msg.fileUrl}" controls style="max-width: 200px; cursor: pointer;" onclick="openModal('${msg.fileUrl}', 'video', '${msg.fileName}')"></video>`;
                } else {
                    content += `<a href="${msg.fileUrl}" onclick="downloadFile('${msg.fileUrl}', '${msg.fileName}'); return false;">${msg.fileName}</a>`;
                }
            } else {
                content += `<strong>${displayName}</strong>: ${msg.text}`;
            }
            if (msg.sent) {
                content += `<span class="read-check" id="read-${msg.timestamp}" style="white-space: nowrap; margin-left: 5px;">`;
                if (msg.read) {
                    content += '✔✔';
                } else if (msg.delivered) {
                    content += '✔✔';
                } else {
                    content += '✔';
                }
                content += '</span>';
            }
            content += `
                <div class="dropdown">
                    <button class="dropdown-btn" onclick="toggleDropdown(event, '${msg.timestamp}')"><i class="fas fa-ellipsis-v"></i></button>
                </div>`;
        }
        div.innerHTML = content;
        if (msg.sent) {
            const readCheck = div.querySelector('.read-check');
            if (msg.read) {
                readCheck.classList.add('read');
            } else if (msg.delivered) {
                readCheck.classList.add('delivered');
            }
        }
        messages.appendChild(div);

        let dropdown = document.getElementById(`dropdown-${msg.timestamp}`);
        if (!dropdown) {
            dropdown = document.createElement('div');
            dropdown.id = `dropdown-${msg.timestamp}`;
            dropdown.className = 'dropdown-content';
            let dropdownContent = `
                <button onclick="replyToMessage('${roomId}', ${msg.timestamp})">Responder</button>`;
            if (msg.sender === myFullId && msg.type === 'sent') {
                dropdownContent += `
                    <button class="delete-btn" onclick="showDeleteOptions(event, '${roomId}', ${msg.timestamp})">Apagar</button>`;
            } else if (msg.type === 'received') {
                dropdownContent += `
                    <button onclick="deleteMessageForMe('${roomId}', ${msg.timestamp})">Apagar para mim</button>`;
            }
            dropdown.innerHTML = dropdownContent;
            document.body.appendChild(dropdown);
        }

        let subDropdown = document.getElementById(`delete-options-${msg.timestamp}`);
        if (msg.sender === myFullId && msg.type === 'sent' && !subDropdown) {
            subDropdown = document.createElement('div');
            subDropdown.id = `delete-options-${msg.timestamp}`;
            subDropdown.className = 'dropdown-content';
            subDropdown.innerHTML = `
                <button onclick="deleteMessageForMe('${roomId}', ${msg.timestamp})">Apagar apenas para mim</button>
                <button onclick="deleteMessageForAll('${roomId}', ${msg.timestamp})">Apagar para todos</button>`;
            document.body.appendChild(subDropdown);
        }

        if (msg.sent && msg.new) {
            setTimeout(() => {
                div.classList.remove('new');
                msg.new = false;
            }, 300);
        }
    });
    messages.scrollTop = messages.scrollHeight;
}

function downloadFile(url, fileName) {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function sendMessage() {
    const input = document.getElementById('message-input');
    const message = input.value.trim();
    if (message && currentRoom) {
        const timestamp = Date.now();
        const contactFullId = currentRoom.split('-').find(id => id !== myFullId);
        const messageData = {
            type: 'message',
            toFullId: contactFullId,
            message: CryptoJS.AES.encrypt(message, encryptionKey).toString(),
            timestamp,
            replyTo: replyingTo ? replyingTo.timestamp : null
        };
        ws.send(JSON.stringify(messageData));
        addMessage(message, 'sent', currentRoom, myFullId, timestamp, messageData.replyTo, true, false, false, true);
        input.value = '';
        cancelReply();
        hideEmojiPicker();
        hideFilePicker();
    }
}

function addMessage(text, type, roomId, sender, timestamp, replyTo, sent = false, delivered = false, read = false, isNew = false) {
    if (!roomMessages.has(roomId)) roomMessages.set(roomId, []);
    const messageData = { text, type, sender, timestamp, sent, delivered, read, replyTo, deleted: false, new: isNew };
    roomMessages.get(roomId).push(messageData);
    if (currentRoom === roomId) loadRoomMessages(roomId);
}

function addFileMessage(fileUrl, fileName, type, roomId, sender, timestamp, replyTo, sent = false, delivered = false, read = false) {
    if (!roomMessages.has(roomId)) roomMessages.set(roomId, []);
    const messageData = { fileUrl, fileName, type, sender, timestamp, sent, delivered, read, replyTo, deleted: false };
    roomMessages.get(roomId).push(messageData);
    if (currentRoom === roomId) loadRoomMessages(roomId);
}

function markAsDelivered(messageId) {
    let affectedRoomId = null;
    let updated = false;
    roomMessages.forEach((messages, roomId) => {
        const msg = messages.find(m => m.timestamp === messageId);
        if (msg && msg.sender === myFullId && !msg.delivered) {
            msg.delivered = true;
            updated = true;
            affectedRoomId = roomId;
            console.log(`Mensagem ${messageId} marcada como entregue em ${roomId}. Estado atual:`, msg);
        }
    });
    if (updated && affectedRoomId === currentRoom) {
        console.log(`Recarregando chat ${affectedRoomId} devido a notificação 'delivered'`);
        loadRoomMessages(affectedRoomId);
    }
}

function markAsRead(messageId) {
    roomMessages.forEach((messages, roomId) => {
        const msg = messages.find(m => m.timestamp === messageId);
        if (msg && msg.sender === myFullId) {
            msg.read = true;
            msg.delivered = true;
            if (currentRoom === roomId) {
                console.log(`Recarregando chat ${roomId} devido a notificação 'read'`);
                loadRoomMessages(roomId);
            }
        }
    });
}

function toggleDropdown(event, timestamp) {
    event.stopPropagation();
    const dropdown = document.getElementById(`dropdown-${timestamp}`);
    const button = event.target.closest('.dropdown-btn');

    document.querySelectorAll('.dropdown-content.show').forEach(el => {
        if (el !== dropdown) {
            el.classList.remove('show');
            el.style.top = 'auto';
            el.style.left = 'auto';
        }
    });
    document.querySelectorAll('.dropdown-content').forEach(el => {
        if (el.id.startsWith('delete-options-') && el.id !== `delete-options-${timestamp}`) {
            el.style.display = 'none';
        }
    });

    dropdown.classList.toggle('show');

    if (dropdown.classList.contains('show')) {
        const buttonRect = button.getBoundingClientRect();
        let top = buttonRect.bottom + 5;
        let left = buttonRect.left;

        dropdown.style.top = `${top}px`;
        dropdown.style.left = `${left}px`;

        const dropdownRect = dropdown.getBoundingClientRect();
        if (dropdownRect.bottom > window.innerHeight) {
            top = buttonRect.top - dropdownRect.height - 5;
            dropdown.style.top = `${top}px`;
        }
        if (dropdownRect.right > window.innerWidth) {
            left = window.innerWidth - dropdownRect.width;
            dropdown.style.left = `${left}px`;
        }
    } else {
        dropdown.style.top = 'auto';
        dropdown.style.left = 'auto';
        const subDropdown = document.getElementById(`delete-options-${timestamp}`);
        if (subDropdown) subDropdown.style.display = 'none';
    }
}

function showDeleteOptions(event, roomId, timestamp) {
    event.stopPropagation();
    const subDropdown = document.getElementById(`delete-options-${timestamp}`);
    const button = event.target.closest('.delete-btn');
    const parentDropdown = document.getElementById(`dropdown-${timestamp}`);

    if (!subDropdown) return;

    document.querySelectorAll('.dropdown-content').forEach(el => {
        if (el.id.startsWith('delete-options-') && el !== subDropdown) {
            el.style.display = 'none';
        }
    });

    if (subDropdown.style.display === 'none' || subDropdown.style.display === '') {
        subDropdown.style.display = 'block';
    } else {
        subDropdown.style.display = 'none';
        return;
    }

    const buttonRect = button.getBoundingClientRect();
    let top = buttonRect.bottom + 5;
    let left = buttonRect.left;

    subDropdown.style.top = `${top}px`;
    subDropdown.style.left = `${left}px`;

    const subDropdownRect = subDropdown.getBoundingClientRect();
    if (subDropdownRect.bottom > window.innerHeight) {
        top = buttonRect.top - subDropdownRect.height - 5;
        subDropdown.style.top = `${top}px`;
    }
    if (subDropdownRect.right > window.innerWidth) {
        left = window.innerWidth - subDropdownRect.width;
        subDropdown.style.left = `${left}px`;
    }

    parentDropdown.classList.add('show');
}

function deleteMessageForMe(roomId, timestamp) {
    const messages = roomMessages.get(roomId);
    const index = messages.findIndex(m => m.timestamp === timestamp);
    if (index !== -1) {
        messages.splice(index, 1);
        removeDropdowns(timestamp);
        if (currentRoom === roomId) loadRoomMessages(roomId);
    }
}

function deleteMessageForAll(roomId, timestamp) {
    const messages = roomMessages.get(roomId);
    const index = messages.findIndex(m => m.timestamp === timestamp);
    if (index !== -1 && messages[index].sender === myFullId) {
        const contact = roomId.split('-').find(n => n !== myFullId);
        ws.send(JSON.stringify({ type: 'delete', roomId, timestamp, contact }));
        markMessageAsDeleted(roomId, timestamp);
        removeDropdowns(timestamp);
    }
}

function markMessageAsDeleted(roomId, timestamp) {
    const messages = roomMessages.get(roomId);
    const msg = messages.find(m => m.timestamp === timestamp);
    if (msg) {
        msg.deleted = true;
        msg.text = 'Essa mensagem foi apagada';
        delete msg.fileUrl;
        delete msg.fileName;
        removeDropdowns(timestamp);
        if (currentRoom === roomId) loadRoomMessages(roomId);
    }
}

function removeDropdowns(timestamp) {
    const dropdown = document.getElementById(`dropdown-${timestamp}`);
    const subDropdown = document.getElementById(`delete-options-${timestamp}`);
    if (dropdown) dropdown.remove();
    if (subDropdown) subDropdown.remove();
}

function replyToMessage(roomId, timestamp) {
    const messages = roomMessages.get(roomId);
    const msg = messages.find(m => m.timestamp === timestamp);
    if (msg && !msg.deleted) {
        replyingTo = msg;
        const displayName = getDisplayName(msg.sender);
        document.getElementById('reply-content').innerHTML = `<strong>${displayName}</strong>: ${msg.text || msg.fileName}`;
        document.getElementById('reply-preview').style.display = 'flex';
        document.getElementById('message-input').focus();
    }
}

function cancelReply() {
    replyingTo = null;
    document.getElementById('reply-preview').style.display = 'none';
}

function toggleEmojiPicker(event) {
    event.stopPropagation();
    const picker = document.getElementById('emoji-picker');
    if (picker.style.display === 'none' || picker.style.display === '') {
        picker.style.display = 'grid';
        hideFilePicker();
    } else {
        picker.style.display = 'none';
    }
}

document.addEventListener('click', function(event) {
    const picker = document.getElementById('emoji-picker');
    const emojiBtn = document.querySelector('.emoji-btn');
    if (!picker.contains(event.target) && !emojiBtn.contains(event.target)) {
        picker.style.display = 'none';
    }
});

function hideEmojiPicker() {
    const picker = document.getElementById('emoji-picker');
    if (picker) picker.style.display = 'none';
}

function loadEmojiPicker() {
    const picker = document.getElementById('emoji-picker');
    if (!picker) return;
    picker.innerHTML = '';
    emojis.forEach(emoji => {
        const span = document.createElement('span');
        span.textContent = emoji;
        span.onclick = () => {
            const input = document.getElementById('message-input');
            input.value += emoji;
            input.focus();
        };
        picker.appendChild(span);
    });
}

function toggleFilePicker() {
    const picker = document.getElementById('file-picker');
    const isHidden = picker.style.display === 'none' || picker.style.display === '';
    
    hideEmojiPicker();
    if (isHidden) {
        picker.style.display = 'block';
    } else {
        picker.style.display = 'none';
    }

    const closePicker = (event) => {
        if (!picker.contains(event.target) && !event.target.closest('.file-btn')) {
            picker.style.display = 'none';
            document.removeEventListener('click', closePicker);
        }
    };

    if (isHidden) {
        setTimeout(() => document.addEventListener('click', closePicker), 0);
    }
}

function hideFilePicker() {
    const picker = document.getElementById('file-picker');
    if (picker) picker.style.display = 'none';
}

function loadFilePicker() {
    const picker = document.getElementById('file-picker');
    if (!picker) return;
    picker.innerHTML = '';
    fileOptions.forEach(option => {
        const button = document.createElement('button');
        button.textContent = option.name;
        button.onclick = (event) => {
            event.stopPropagation();
            const fileInput = document.getElementById('file-input');
            fileInput.setAttribute('accept', option.accept);
            fileInput.value = '';
            fileInput.click();
            hideFilePicker();
        };
        picker.appendChild(button);
    });
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (file && currentRoom) {
        const timestamp = Date.now();
        const contactFullId = currentRoom.split('-').find(id => id !== myFullId);
        const formData = new FormData();
        formData.append('file', file);

        fetch('http://192.168.3.122:3000/upload', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            const fileData = {
                type: 'file',
                toFullId: contactFullId,
                fileUrl: data.fileUrl,
                fileName: data.fileName,
                timestamp,
                replyTo: replyingTo ? replyingTo.timestamp : null
            };
            ws.send(JSON.stringify(fileData));
            addFileMessage(data.fileUrl, data.fileName, 'sent', currentRoom, myFullId, timestamp, fileData.replyTo, true, false, false);
            cancelReply();
        })
        .catch(error => console.error('Erro ao fazer upload do arquivo:', error));
        event.target.value = '';
    }
}

function toggleMode() {
    const body = document.body;
    const modeToggle = document.querySelector('.mode-toggle i');
    if (body.classList.contains('light-mode')) {
        body.classList.remove('light-mode');
        body.classList.add('dark-mode');
        modeToggle.classList.remove('fa-moon');
        modeToggle.classList.add('fa-sun');
        localStorage.setItem('mode', 'dark');
    } else {
        body.classList.remove('dark-mode');
        body.classList.add('light-mode');
        modeToggle.classList.remove('fa-sun');
        modeToggle.classList.add('fa-moon');
        localStorage.setItem('mode', 'light');
    }
}

function loadMode() {
    const savedMode = localStorage.getItem('mode');
    const body = document.body;
    const modeToggle = document.querySelector('.mode-toggle i');
    if (savedMode === 'dark') {
        body.classList.remove('light-mode');
        body.classList.add('dark-mode');
        modeToggle.classList.remove('fa-moon');
        modeToggle.classList.add('fa-sun');
    } else {
        body.classList.add('light-mode');
        modeToggle.classList.add('fa-moon');
    }
}

function deleteContact(contactFullId) {
    const index = contacts.findIndex(c => c.fullId === contactFullId);
    if (index !== -1) {
        contacts.splice(index, 1);
        updateContactsList();
        if (currentRoom === generateRoomId(myFullId, contactFullId)) {
            currentRoom = null;
            document.getElementById('room-title').textContent = 'Selecione um chat';
            document.getElementById('room-subtitle').textContent = '';
            document.getElementById('messages').innerHTML = '';
        }
        roomMessages.delete(generateRoomId(myFullId, contactFullId));
    }
}

function toggleContactDropdown(event, contactFullId) {
    event.stopPropagation();
    const dropdown = document.getElementById(`contact-dropdown-${contactFullId}`);
    dropdown.classList.toggle('show');
    document.querySelectorAll('.contact-dropdown-content.show').forEach(el => {
        if (el !== dropdown) el.classList.remove('show');
    });
}

document.addEventListener('click', (event) => {
    document.querySelectorAll('.dropdown-content.show').forEach(el => {
        if (!el.contains(event.target)) {
            el.classList.remove('show');
            el.style.top = 'auto';
            el.style.left = 'auto';
        }
    });
    document.querySelectorAll('.contact-dropdown-content.show').forEach(el => {
        if (!el.contains(event.target)) el.classList.remove('show');
    });
});

function openModal(url, type, fileName) {
    const modal = document.getElementById('media-modal');
    const modalImage = document.getElementById('modal-image');
    const modalVideo = document.getElementById('modal-video');
    const downloadBtn = document.querySelector('.download-btn');

    modalImage.style.display = 'none';
    modalVideo.style.display = 'none';
    modalImage.style.transform = 'none';

    if (type === 'image') {
        modalImage.src = url;
        modalImage.style.display = 'block';
        modalImage.onclick = (e) => toggleZoom(e, modalImage);
    } else if (type === 'video') {
        modalVideo.src = url;
        modalVideo.style.display = 'block';
    }

    downloadBtn.onclick = () => downloadFile(url, fileName);
    modal.style.display = 'flex';
}

function closeModal() {
    const modal = document.getElementById('media-modal');
    const modalVideo = document.getElementById('modal-video');
    modal.style.display = 'none';
    modalVideo.pause();
    modalVideo.src = '';
}

function toggleZoom(event, image) {
    if (image.style.transform === 'none' || image.style.transform === '') {
        const rect = image.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const scale = 2;

        const originX = (x / rect.width) * 100;
        const originY = (y / rect.height) * 100;

        image.style.transformOrigin = `${originX}% ${originY}%`;
        image.style.transform = `scale(${scale})`;
    } else {
        image.style.transform = 'none';
    }
}