
# 📱 Chat Seguro

**Chat Seguro** é uma aplicação de mensagens em tempo real que permite aos usuários se registrarem, adicionarem contatos e trocarem mensagens (incluindo arquivos) de forma segura usando WebSocket com criptografia AES.

## 🧩 Tecnologias Utilizadas

- **Frontend:** HTML, CSS, JavaScript
- **Backend:** Node.js, Express, WebSocket (`ws`)
- **Banco de dados:** SQLite
- **Uploads de arquivos:** Multer
- **Criptografia:** CryptoJS (AES)

---

## ⚙️ Preparação do Ambiente

### Pré-requisitos:

- Node.js (versão 14+)
- npm (gerenciador de pacotes do Node.js)

### Passos para rodar o projeto:

1. **Clone o repositório:**

```bash
git clone https://github.com/seu-usuario/chat-seguro.git
cd chat-seguro
```

2. **Instale as dependências:**

```bash
npm install
```

3. **Configure o IP da sua máquina:**

O sistema utiliza um IP fixo (por padrão: `192.168.3.122`).  
Para funcionar corretamente na sua rede local, você deve:

- Descobrir o **IPv4 da sua máquina** (ex: `192.168.1.100`)
- Substituir **todas as ocorrências do IP fixo** nos seguintes arquivos:
  - `public/script.js` → substitua `ws://192.168.3.122:3000` pelo IP da sua máquina.
  - `server.js` → substitua todas as menções a `192.168.3.122` (inclusive no `fileUrl` de uploads e no `listen`).

> 💡 **Dica:** use um editor como VS Code e pesquise por `192.168` para substituir em todos os lugares.

4. **Inicie o servidor:**

```bash
npm start
```

O servidor será iniciado em: `http://SEU-IP:3000`  
(ex: `http://192.168.1.100:3000`)

---

## 💬 Como Usar

1. Acesse no navegador o IP do servidor: `http://<seu-ip>:3000`
2. Registre-se com um identificador (e-mail ou telefone), nome de usuário e senha.
3. Compartilhe seu "código de amizade" (ex: `usuario#1234`) para ser adicionado por outros.
4. Adicione contatos pelo código de amizade.
5. Envie mensagens, emojis, arquivos e veja indicadores de digitação, entregas e leituras.

---

## 📁 Estrutura do Projeto

```
chat-seguro/
├── public/
│   ├── index.html         # Interface principal do chat
│   ├── style.css          # Estilo visual
│   └── script.js          # Lógica do cliente
├── uploads/               # Diretório de arquivos enviados
├── chat.db                # Banco de dados SQLite
├── server.js              # Servidor Express + WebSocket
├── package.json           # Dependências e scripts
```

---

## 📦 Comandos Disponíveis

| Comando         | Descrição                            |
|----------------|----------------------------------------|
| `npm install`  | Instala as dependências do projeto     |
| `npm start`    | Inicia o servidor local                |

---

## 🔐 Segurança

- Todas as mensagens são criptografadas no cliente com AES (`CryptoJS`).
- Os arquivos são armazenados localmente no servidor, com rotas de acesso restritas.

---
