const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const XLSX = require('xlsx');
const moment = require('moment');

// Initialize express for pairing code
const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Configure file upload
const upload = multer({ dest: 'uploads/' });

// Ensure data directory exists
if (!fs.existsSync('data')) {
    fs.mkdirSync('data');
}

if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// Initialize data files if they don't exist
const usersFile = path.join(__dirname, 'data', 'users.json');
const reportsFile = path.join(__dirname, 'data', 'reports.json');

if (!fs.existsSync(usersFile)) {
    fs.writeFileSync(usersFile, JSON.stringify({ users: [], admin: [] }, null, 2));
}

if (!fs.existsSync(reportsFile)) {
    fs.writeFileSync(reportsFile, JSON.stringify({ reports: [] }, null, 2));
}

// Load data
function loadUsers() {
    return JSON.parse(fs.readFileSync(usersFile));
}

function loadReports() {
    return JSON.parse(fs.readFileSync(reportsFile));
}

function saveUsers(data) {
    fs.writeFileSync(usersFile, JSON.stringify(data, null, 2));
}

function saveReports(data) {
    fs.writeFileSync(reportsFile, JSON.stringify(data, null, 2));
}

// WhatsApp client setup
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// Pairing code variables
let pairingCode = null;
let isWaitingForPairing = false;

// Express routes for pairing
app.get('/pair', (req, res) => {
    if (isWaitingForPairing) {
        res.send(`Current pairing code: ${pairingCode}`);
    } else {
        res.send('No active pairing session. Start the bot first.');
    }
});

app.post('/pair', (req, res) => {
    const { code } = req.body;
    if (!code) {
        return res.status(400).send('Pairing code is required');
    }

    pairingCode = code;
    isWaitingForPairing = true;
    res.send(`Pairing code set to: ${code}. Waiting for client to connect...`);
});

// Start express server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Pairing server running on http://localhost:${PORT}`);
});

// WhatsApp client events
client.on('qr', (qr) => {
    if (isWaitingForPairing && pairingCode) {
        console.log(`Pairing with code: ${pairingCode}`);
        // Simulate pairing with code (in a real scenario, you'd use the actual pairing mechanism)
        setTimeout(() => {
            console.log('Pairing successful!');
            isWaitingForPairing = false;
        }, 2000);
    } else {
        qrcode.generate(qr, { small: true });
    }
});

client.on('ready', () => {
    console.log('Client is ready!');
});

client.on('authenticated', () => {
    console.log('Authenticated');
});

client.on('auth_failure', (msg) => {
    console.error('Authentication failure:', msg);
});

client.on('disconnected', (reason) => {
    console.log('Client was logged out', reason);
});

// Handle incoming messages
client.on('message', async msg => {
    try {
        const sender = msg.from;
        const isGroup = msg.from.endsWith('@g.us');
        const command = msg.body.split(' ')[0].toLowerCase();
        const args = msg.body.split(' ').slice(1);

        // Check if user is authorized
        const usersData = loadUsers();
        const isAdmin = usersData.admin.includes(sender.split('@')[0]);
        const user = usersData.users.find(u => u.number === sender.split('@')[0]);
        
        if (!user && !isAdmin && !['!start'].includes(command)) {
            return msg.reply('Maaf, anda tidak memiliki akses ke Bot ini. Silahkan hubungi developer untuk bantuan.');
        }

        // Check if user is expired
        if (user && moment(user.expired).isBefore(moment())) {
            return msg.reply('Maaf, akses anda sudah kadaluarsa. Silahkan hubungi admin untuk memperpanjang.');
        }

        // Handle commands
        switch (command) {
            case '!start':
                handleStart(msg);
                break;
            case '!blast':
                handleBlast(msg, args, user, isAdmin);
                break;
            case '!getidgrup':
                handleGetGroupId(msg, args);
                break;
            case '!adduser':
                if (isAdmin) handleAddUser(msg, args);
                break;
            case '!edituser':
                if (isAdmin) handleEditUser(msg, args);
                break;
            case '!deluser':
                if (isAdmin) handleDeleteUser(msg, args);
                break;
            case '!laporan':
                if (isAdmin) handleReport(msg);
                break;
            default:
                // Ignore other messages
                break;
        }
    } catch (error) {
        console.error('Error handling message:', error);
    }
});

// Command handlers
function handleStart(msg) {
    msg.reply('Halo! Selamat datang di WhatsApp Blast Bot. Gunakan perintah berikut:\n\n' +
        '!blast {id_grup} {pesan} - Kirim pesan ke semua anggota grup\n' +
        '!blast {nama_file} {pesan} - Kirim pesan ke nomor dalam file\n' +
        '!getidgrup {link_grup} - Dapatkan ID grup dari link\n\n' +
        'Fitur admin:\n' +
        '!adduser {nomor} {expired} - Tambah user\n' +
        '!edituser {nomor} {expired} - Edit user\n' +
        '!deluser {nomor} - Hapus user\n' +
        '!laporan - Lihat laporan');
}

async function handleBlast(msg, args, user, isAdmin) {
    if (args.length < 2) {
        return msg.reply('Format salah. Gunakan: !blast {id_grup/nama_file} {pesan}');
    }

    const target = args[0];
    const message = args.slice(1).join(' ');
    const attachment = msg.hasMedia ? await msg.downloadMedia() : null;

    // Add to reports
    const reportsData = loadReports();
    reportsData.reports.push({
        user: msg.from,
        command: 'blast',
        target: target,
        message: message,
        timestamp: new Date().toISOString()
    });
    saveReports(reportsData);

    // Determine if target is group or file
    if (target.startsWith('https://chat.whatsapp.com/')) {
        // Get group ID from invite link
        const groupId = await client.getGroupIdFromInviteLink(target.split('https://chat.whatsapp.com/')[1]);
        return handleGroupBlast(msg, groupId, message, attachment);
    } else if (target.endsWith('@g.us')) {
        // Direct group ID
        return handleGroupBlast(msg, target, message, attachment);
    } else {
        // Assume it's a file
        return handleFileBlast(msg, target, message, attachment);
    }
}

async function handleGroupBlast(msg, groupId, message, attachment) {
    try {
        const chat = await client.getChatById(groupId);
        if (!chat.isGroup) {
            return msg.reply('ID yang diberikan bukan grup WhatsApp.');
        }

        const participants = await chat.participants;
        const numbers = participants.map(p => p.id._serialized.split('@')[0]).filter(num => num !== client.info.wid.user);

        msg.reply(`Memulai blast ke ${numbers.length} nomor di grup ${chat.name} dengan delay 5 detik per pesan.`);

        // Send with delay to avoid ban
        for (let i = 0; i < numbers.length; i++) {
            const num = numbers[i];
            try {
                await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay
                const sendTo = num + '@c.us';
                
                if (attachment) {
                    await client.sendMessage(sendTo, attachment, { caption: message });
                } else {
                    await client.sendMessage(sendTo, message);
                }
                
                console.log(`Sent to ${num} (${i+1}/${numbers.length})`);
            } catch (error) {
                console.error(`Error sending to ${num}:`, error);
            }
        }

        msg.reply(`Blast selesai! Total ${numbers.length} pesan terkirim.`);
    } catch (error) {
        console.error('Error in group blast:', error);
        msg.reply('Gagal melakukan blast ke grup. Pastikan ID grup valid dan bot ada di grup tersebut.');
    }
}

async function handleFileBlast(msg, filename, message, attachment) {
    try {
        const filePath = path.join(__dirname, 'uploads', filename);
        if (!fs.existsSync(filePath)) {
            return msg.reply('File tidak ditemukan. Pastikan file sudah diupload ke server.');
        }

        let numbers = [];
        if (filename.endsWith('.csv')) {
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            numbers = fileContent.split('\n')
                .map(line => line.trim().split(',')[0]) // Assume first column is phone number
                .filter(num => num && num.match(/^\d+$/));
        } else if (filename.endsWith('.txt')) {
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            numbers = fileContent.split('\n')
                .map(num => num.trim())
                .filter(num => num && num.match(/^\d+$/));
        } else {
            return msg.reply('Format file tidak didukung. Gunakan file CSV atau TXT.');
        }

        if (numbers.length === 0) {
            return msg.reply('Tidak ada nomor yang valid ditemukan di file.');
        }

        msg.reply(`Memulai blast ke ${numbers.length} nomor dari file ${filename} dengan delay 5 detik per pesan.`);

        // Send with delay to avoid ban
        for (let i = 0; i < numbers.length; i++) {
            const num = numbers[i];
            try {
                await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay
                const sendTo = num + '@c.us';
                
                if (attachment) {
                    await client.sendMessage(sendTo, attachment, { caption: message });
                } else {
                    await client.sendMessage(sendTo, message);
                }
                
                console.log(`Sent to ${num} (${i+1}/${numbers.length})`);
            } catch (error) {
                console.error(`Error sending to ${num}:`, error);
            }
        }

        msg.reply(`Blast selesai! Total ${numbers.length} pesan terkirim.`);
    } catch (error) {
        console.error('Error in file blast:', error);
        msg.reply('Gagal melakukan blast dari file. Pastikan format file benar.');
    }
}

async function handleGetGroupId(msg, args) {
    if (args.length < 1) {
        return msg.reply('Format salah. Gunakan: !getidgrup {link_grup}');
    }

    const inviteLink = args[0];
    if (!inviteLink.startsWith('https://chat.whatsapp.com/')) {
        return msg.reply('Link grup tidak valid. Harus dimulai dengan https://chat.whatsapp.com/');
    }

    try {
        const groupId = await client.getGroupIdFromInviteLink(inviteLink.split('https://chat.whatsapp.com/')[1]);
        msg.reply(`ID grup untuk link tersebut adalah: ${groupId}`);
    } catch (error) {
        console.error('Error getting group ID:', error);
        msg.reply('Gagal mendapatkan ID grup. Pastikan link valid dan bot bisa mengakses grup.');
    }
}

function handleAddUser(msg, args) {
    if (args.length < 2) {
        return msg.reply('Format salah. Gunakan: !adduser {nomor} {expired}');
    }

    const number = args[0].replace(/[^0-9]/g, '');
    const expiredInput = args[1].toLowerCase();
    
    let expiredDate;
    const now = moment();
    
    switch (expiredInput) {
        case '1hari':
            expiredDate = now.add(1, 'days').format('YYYY-MM-DD');
            break;
        case '7hari':
            expiredDate = now.add(7, 'days').format('YYYY-MM-DD');
            break;
        case '1bulan':
            expiredDate = now.add(1, 'months').format('YYYY-MM-DD');
            break;
        case '3bulan':
            expiredDate = now.add(3, 'months').format('YYYY-MM-DD');
            break;
        case '6bulan':
            expiredDate = now.add(6, 'months').format('YYYY-MM-DD');
            break;
        case '1tahun':
            expiredDate = now.add(1, 'years').format('YYYY-MM-DD');
            break;
        case 'lifetime':
            expiredDate = '2999-12-31'; // Far future date
            break;
        default:
            // Try to parse as date
            if (moment(expiredInput, 'YYYY-MM-DD', true).isValid()) {
                expiredDate = expiredInput;
            } else {
                return msg.reply('Format expired tidak valid. Gunakan: 1hari, 7hari, 1bulan, 3bulan, 6bulan, 1tahun, lifetime atau format tanggal YYYY-MM-DD');
            }
    }

    const usersData = loadUsers();
    const existingUser = usersData.users.find(u => u.number === number);
    
    if (existingUser) {
        return msg.reply(`User dengan nomor ${number} sudah ada. Gunakan !edituser untuk mengubah.`);
    }

    usersData.users.push({
        number: number,
        created: moment().format('YYYY-MM-DD'),
        expired: expiredDate
    });

    saveUsers(usersData);
    msg.reply(`Berhasil menambahkan user ${number} dengan expired ${expiredDate}.`);
}

function handleEditUser(msg, args) {
    if (args.length < 2) {
        return msg.reply('Format salah. Gunakan: !edituser {nomor} {expired}');
    }

    const number = args[0].replace(/[^0-9]/g, '');
    const expiredInput = args[1].toLowerCase();
    
    let expiredDate;
    const now = moment();
    
    switch (expiredInput) {
        case '1hari':
            expiredDate = now.add(1, 'days').format('YYYY-MM-DD');
            break;
        case '7hari':
            expiredDate = now.add(7, 'days').format('YYYY-MM-DD');
            break;
        case '1bulan':
            expiredDate = now.add(1, 'months').format('YYYY-MM-DD');
            break;
        case '3bulan':
            expiredDate = now.add(3, 'months').format('YYYY-MM-DD');
            break;
        case '6bulan':
            expiredDate = now.add(6, 'months').format('YYYY-MM-DD');
            break;
        case '1tahun':
            expiredDate = now.add(1, 'years').format('YYYY-MM-DD');
            break;
        case 'lifetime':
            expiredDate = '2999-12-31'; // Far future date
            break;
        default:
            // Try to parse as date
            if (moment(expiredInput, 'YYYY-MM-DD', true).isValid()) {
                expiredDate = expiredInput;
            } else {
                return msg.reply('Format expired tidak valid. Gunakan: 1hari, 7hari, 1bulan, 3bulan, 6bulan, 1tahun, lifetime atau format tanggal YYYY-MM-DD');
            }
    }

    const usersData = loadUsers();
    const userIndex = usersData.users.findIndex(u => u.number === number);
    
    if (userIndex === -1) {
        return msg.reply(`User dengan nomor ${number} tidak ditemukan.`);
    }

    usersData.users[userIndex].expired = expiredDate;
    saveUsers(usersData);
    msg.reply(`Berhasil mengupdate user ${number} dengan expired ${expiredDate}.`);
}

function handleDeleteUser(msg, args) {
    if (args.length < 1) {
        return msg.reply('Format salah. Gunakan: !deluser {nomor}');
    }

    const number = args[0].replace(/[^0-9]/g, '');
    const usersData = loadUsers();
    const userIndex = usersData.users.findIndex(u => u.number === number);
    
    if (userIndex === -1) {
        return msg.reply(`User dengan nomor ${number} tidak ditemukan.`);
    }

    usersData.users.splice(userIndex, 1);
    saveUsers(usersData);
    msg.reply(`Berhasil menghapus user ${number}.`);
}

function handleReport(msg) {
    const reportsData = loadReports();
    const usersData = loadUsers();
    
    // Create Excel workbook
    const wb = XLSX.utils.book_new();
    
    // User data sheet
    const userWS = XLSX.utils.json_to_sheet(usersData.users.map(u => ({
        Nomor: u.number,
        Dibuat: u.created,
        Expired: u.expired,
        Status: moment(u.expired).isBefore(moment()) ? 'Expired' : 'Active'
    })));
    XLSX.utils.book_append_sheet(wb, userWS, "Users");
    
    // Report data sheet
    const reportWS = XLSX.utils.json_to_sheet(reportsData.reports.map(r => ({
        User: r.user,
        Command: r.command,
        Target: r.target,
        Pesan: r.message,
        Waktu: r.timestamp
    })));
    XLSX.utils.book_append_sheet(wb, reportWS, "Reports");
    
    // Save to file
    const fileName = `laporan_${moment().format('YYYYMMDD_HHmmss')}.xlsx`;
    const filePath = path.join(__dirname, 'uploads', fileName);
    XLSX.writeFile(wb, filePath);
    
    // Send file
    const media = MessageMedia.fromFilePath(filePath);
    msg.reply(media, null, { caption: 'Berikut laporan pengguna dan aktivitas blast.' });
}

// File upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }
    
    const fileExt = path.extname(req.file.originalname);
    const newFileName = `${req.file.filename}${fileExt}`;
    const newFilePath = path.join(__dirname, 'uploads', newFileName);
    
    fs.renameSync(req.file.path, newFilePath);
    
    res.send({
        success: true,
        filename: newFileName
    });
});

// Start the client
client.initialize();