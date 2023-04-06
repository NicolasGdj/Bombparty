'use strict';

let express = require('express');
let app = express();
let fs = require('fs');
let http = require('http').createServer(app);
let bodyParser = require('body-parser');
let session = require('express-session');
let io = require('socket.io')(http);
let Channel = require('./modules/Channel');
let Sequelize = require('sequelize');
let config = require('./config');

//Moteur de template
app.set('view engine', 'ejs');

//SQL
let sequelize = new Sequelize(config.database.database, config.database.login, config.database.password, {
    host: config.database.host,
    dialect: config.database.dialect,
    pool: {
        max: 10000,
        min: 1,
        idle: 100000
    }
});
sequelize
    .authenticate()
    .then(() => {
        console.log('Connection has been established successfully.');
    })
    .catch(err => {
        console.error('Unable to connect to the database:', err);
    });

const DataTypes = Sequelize.DataTypes;
const Model = Sequelize.Model;
const Op = Sequelize.Op;

class Word extends Model{}
Word.init({
   id: {
       type: DataTypes.INTEGER,
       primaryKey: true,
       autoIncrement: true,
   },
    word: {
       type: DataTypes.STRING,
    }
}, {
    sequelize,
    modelName: 'words'
});

/*
//Words injector
let wordf = require('./modules/wordf');
let wordresult;
let i = 0;
for(let word of wordf){
    if(i % 100000 == 0){
        if(wordresult !== undefined)
            sequelize.query(wordresult);
        wordresult = "INSERT INTO words (word) VALUES ('lambda" + i +"')";
    }
    ++i;
    if(!word.includes(" ")) {
        wordresult += ",('"+word.normalize("NFD").replace(/[\u0300-\u036f]/g, "") +"')";
    }else{
       // console.log( " X " + word + "'s not passed");
    }
}
sequelize.query(wordresult);
*/

// Middleware
app.use('/assets', express.static('public'));
app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());
app.use(session({
    secret: config.session_key,
    resave: false,
    saveUninitialized: true,
    cookie: {secure: false}
}));//
app.use(require('./middlewares/flash.js'));

function getChannelsInfo(){
    let channelsinfo = [];
    for(let channel of channels){
        channelsinfo.push({name: channel.getName(), design: (channel.getOwner().design === undefined ? "walter" : channel.getOwner().design), playercount: channel.getPlayerCount(), maxplayers: channel.getMaxPlayers()});
    }
    return channelsinfo;
}
//Routes
app.get('/', (request, response) => {
    response.render('index', {channels: getChannelsInfo()})
});

app.get('/play', (request, response) => {
    response.render('index', {channels: getChannelsInfo()})
});
app.get('/play/:salon', (request, response) => {

    let channelname = request.params.salon;

    if(channelname.length >= 3 && channelname.length <= 15 && (/^[aA-zZ0-9]*$/.test(channelname))){
        response.render('play', {salon: request.params.salon})
    } else {
        response.render('index', {channels: getChannelsInfo()})
    }
});

app.get('*', (request, response) => {
    response.render('index', {channels: getChannelsInfo()})
});

let channels = [];

http.listen(config.port, () => {
    console.log("Server listening on *:" + config.port);
});

io.on('connection', (socket) => {
    socket.name = "Unknown";
    socket.on('try create', (data) => {
        if(data.channelName === undefined)
            return;

        let channelName = data.channelName;
        if(!(channelName.length >= 3 && channelName.length <= 15) || !(/^[aA-zZ0-9]*$/.test(channelName))){
            socket.emit('try create', {code: 402, message: 'Nom du salon incorrect', submessage: 'Le nom d\'un salon doit comporter entre 3 et 15 caracteres alpha-numeriques.'});
            return;
        }
        for(let channel of channels) {
            if (channel.getName() === channelName) {
                socket.emit('try create', {code: 402, message: 'Salon deja existant', submessage: 'Vous pouvez rejoindre ce salon dans la section du dessus.'});

                return;
            }
        }
        socket.emit('try create', {code: 200, message: 'Connexion au salon...', channelName: channelName});

    });

    socket.on('play', (data) => {
        if(data.id === undefined || data.name === undefined || data.design === undefined)
            return;

        let channelName = data.id;
        if(!(channelName.length >= 3 && channelName.length <= 15) || !(/^[aA-zZ0-9]*$/.test(channelName))){
            socket.emit('play', {code: 402, 'message': 'Unknown channel'});
            return;
        }
        if(!(data.name.length >= 3 && data.name.length <= 16) || !(/^[aA-zZ0-9]*$/.test(data.name))) {
            socket.emit('play', {code: 403, 'message': 'Bad username'});
            return;
        }

        if(!(data.design.length >= 3 && data.design.length <= 16) || !(/^[aA-zZ0-9]*$/.test(data.design))) {
            socket.emit('play', {code: 405, 'message': 'Bad design'});
            return;
        }

        socket.name = data.name;
        socket.design = data.design;

        for(let channel of channels) {
            if (channel.getName() === channelName) {
                if(channel.isUser(socket.name)){
                    socket.emit('play', {code: 401, 'message': 'Username already used'});
                    return;
                }
                if(channel.isFull()){
                    socket.emit('play', {code: 406, 'message': 'Channel is full'});
                    return;
                }

                channel.join(socket);
                channel.update();

                return;
            }
        }

        socket.channel = new Channel(channelName, socket);
        channels.push(socket.channel);
        socket.channel.update();

    });


    socket.on('chat message', (data) => {
        if(data.message === undefined)
            return;
        let sender = socket;
        let message = data.message;
        //V�rifier si le joueur est mute ou banni.
        if(socket.channel !== undefined)
            socket.channel.chat(sender, message);
    });

    socket.on('answer word', (data) => {
        if(data.word=== undefined)
            return;
        data.word = data.word.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if(socket.channel !== undefined)
            socket.channel.answer(socket, data.word, (word, next) => {
                if((/^[aA-zZ\-]*$/.test(data.word))) {
                    let result = false;
                    let words = Word.findAll({
                        attributes: ['word'],
                        limit: 1,
                        where: {
                            word: {
                                [Op.eq]: word.toLowerCase()
                            }
                        }
                    }).then((words) => {
                        if (words.length !== 0)
                            next();
                    });
                }
            });
    });

    socket.on('change word', (data) => {
        if(data.word=== undefined )
            return;
        if(socket.channel !== undefined) {
            socket.channel.changeWord(socket, data.word);
        }
    });
    socket.on('votepass', (data) => {
        if(socket.channel !== undefined) {
            socket.channel.votepass(socket);
        }
    });
    socket.on('private chat message', (data) => {
        if(data.message=== undefined || data.cible === undefined)
            return;
        let sender = socket;
        let cible = data.cible;
        let message = data.message;
        //V�rifier si le joueur est mute ou banni.
        if(socket.channel !== undefined)
            socket.channel.privateChat(sender, cible, message);
    });

    socket.on('disconnect', () => {
        let channel = socket.channel;
        if(channel !== undefined){
            channel.quit(socket);
            channel.update();
            if(channel.getPlayerCount() === 0){
                channels.splice(channels.indexOf(channel), 1);
            }
        }
    });

});

let tick = 0;
setInterval(() => {
    ++tick;
    channels.forEach((channel) => {
        if(channel.needMoreSequences()) {
            Word.findAll({
                attributes: ['word'],
                order: sequelize.random(),
                limit: 5
            }).then((words) => words.forEach((word) => {
                let w = word.dataValues.word;
                if(w.length >= 2){
                    let sizeSequence = Math.floor(Math.random() * 2 + 2);

                    let startIndex = Math.floor(Math.random() * (w.length-sizeSequence));
                    let sequence = "";
                    for(let i = startIndex; i < (startIndex+sizeSequence); ++i)
                        sequence+=w.charAt(i);
                    channel.getNextSequences().push({sequence: sequence.toUpperCase(), word: w.toUpperCase()});
                }
            }));

        }
        channel.run(tick)
    });
}, 1000);
