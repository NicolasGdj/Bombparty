module.exports = class Channel {

/*
    [X] Sauter les gens morts.
    [X] Rapprocher les joueurs. (Enfonction des ecrans)
    [X] Vider la barre quand ça deviens notre tour.
    [X] Ajouter courone pour le gagnant
    [X] Filtrer le chat (Min 1 characters)
    [X] Faire un affichage de victoire.
    [X] Colorer les lettres du mot utilisé
    [X] Compteur de point
    [X] Classement (Premier = 3pt, Deuxieme= 2pt, 3eme = 1pt)
    [X]

 */

    constructor(name, owner){
        this.users = [];
        this.maxPlayers = 10;
        this.nextSequences = [];
        this.lastWords = [];
        this.inGame = [];
        this.name = name;
        this.owner = owner;
        this.lastWinner = "";
        this.removeLive = true;
        this.join(owner, 'Joined new channel');
        this.reset();

    }

    getName(){
        return this.name;
    }

    setOwner(owner){
        this.owner = owner;
        this.users.forEach( (user) => {
            user.emit('new owner', owner.id);
        });
    }

    getOwner(){
        return this.owner;
    }

    getNextSequences(){
        return this.nextSequences;
    }

    needMoreSequences(){
        return this.nextSequences.length <= 5;
    }

    getPlayerCount(){
        return this.users.length;
    }

    getMaxPlayers(){
        return this.maxPlayers;
    }

    getUsers(){
        return this.users;
    }

    getUserInfos(){
        let userinfos = [];
        for(let user of this.users){
            userinfos.push({name: user.name, live: user.live, design: user.design, score: user.score});
        }
        return userinfos;
    }

    getInGameInfos(){
        let userinfos = [];
        for(let user of this.inGame){
            userinfos.push({name: user.name, live: user.live, design: user.design, word: user.word, explosion: user.explosion});
        }
        return userinfos;
    }

    isFull(){
        return this.users.length >= this.maxPlayers;
    }
 
    update(){
        let inLive = 0;
        for(let user of this.inGame)
            if(user.live > 0)
                ++inLive;
        let data = {
            channelName: this.getName(),
            maxPlayers: this.maxPlayers,
            playerCount: this.getUsers().length,
            owner: this.getOwner().name,
            players: this.getUserInfos(),
            inGame: this.getInGameInfos(),
            inLive: inLive,
            state: this.state,
            timer: this.timer,
            sequence: (this.sequence === undefined ? "ER" : this.sequence.sequence),
            index: this.index,
            round: this.round,
            lastWinner: this.lastWinner
        };

        this.users.forEach( (user) => {
            data.user = user.name;
            data.design = user.design;
            user.emit('update', data);
        });
    }

    start(){
        this.state = "running";
        this.inGame = this.users.slice();
        this.index = Math.floor(Math.random() * this.inGame.length);
        this.users.forEach((user) => {
            user.live = 2;
            user.explosion = 0;
        });
        this.nextRound(true);
    }

    reset(){
        this.lastWords = [];
        this.inGame = this.users.slice();
        this.state = 'waiting';
        this.maxTimer = 15;
        this.timer = 20;
        this.index = 0;
        this.round = 0;
        this.inGame.forEach((user) => {
            user.explosion = 0;
            user.live = 0;
        });
        /*Debug*/
        //this.timer = 2;
        //this.removeLive = true;
        //this.maxTimer = 200;
        /*End Debug*/
    }

    nextRound(changeSequence = false){
        ++this.round;

        let inLive = 0;
        for(let user of this.inGame)
            if(user.live > 0)
                ++inLive;
        if(inLive === 0){
            this.reset();

            return;
        }else if(inLive === 1){
            for(let user of this.inGame)
                if(user.live > 0){
                    this.win(user);
                    this.update();
                    return;
                }

            return;
        }

        do{
            ++this.index;
            if(this.index >= this.inGame.length) {
                this.index = 0;
                if(this.maxTimer > 3)
                    --this.maxTimer;
            }
        }while(this.inGame[this.index] !== undefined && this.inGame[this.index].live <= 0);

        this.playAllSound("your_turn");
        if(changeSequence) {
            this.sequence = this.nextSequences.length !== 0 ? (this.nextSequences.pop()) : {sequence: "ER", word:"MANGER"};
            this.resetVotepass();
        }
        this.updateVotepass();
        this.timer = this.maxTimer;
        this.update();
        this.inGame.forEach((user) => {
            user.explosion = 0;
        });

    }

    isUser(username){
        for(let user of this.users){
            if(user.name.toLowerCase() === username.toLowerCase()){
                return true;
            }
        }
        return false;
    }

    changeWord(user, word){
        if(this.inGame[this.index] === user){
            user.word = word.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
            this.users.forEach((u) => {
                u.emit('change word', {user: user.name, word: word});
            })
        }
    }

    answer(user, response, verif_function){
        if(this.inGame.length !== 0 && this.inGame[this.index] === user && response.includes(this.sequence.sequence)){
            if(!this.lastWords.includes(response)) {
                verif_function(response.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase(), () => {
                    this.lastWords.push(response);
                    user.word = response;
                    this.playAllSound("sucess");
                    this.nextRound(true);
                },() => {
                    this.playAllSound("fail");
                });
            }
        }
    }

    getMaxVotepass(){
        let inLive = 0;
        for(let user of this.inGame)
            if(user.live > 0)
                ++inLive;
        return inLive > 2 ? inLive-1 : 2;
    }

    playAllSound(sound){
        this.users.forEach((u) => {
            this.playSound(u, sound);
        })
    }

    playSound(user, sound){
        user.emit('play sound', {sound: sound});
    }

    resetVotepass(){
        for(let user of this.users)
            user.votepass = false;
    }

    updateVotepass(){
        let count = 0;
        let found = false;
        for(let user of this.inGame) {
            if (user.live > 0 && user.votepass) {
                if (user === this.inGame[this.index])
                    found = true;
                ++count;
            }
        }

        let max = this.getMaxVotepass();
        if(this.state === 'running' && found && count >= max){
            this.resetVotepass();
            count = 0;
            this.playAllSound("votepass");
            if(this.sequence !== undefined)
                this.chat(undefined, 'La séquence \'' + this.sequence.sequence + '\' a été passée. (Le mot \'' + this.sequence.word + '\' aurait été possible)');
            this.sequence = this.nextSequences.length !== 0 ? (this.nextSequences.pop()) : {sequence: "ER", word: "MERCREDI"};
            this.timer = this.maxTimer;
            this.update();
        }
        this.users.forEach((u) => {
            u.emit('votepass', {current: count, max: this.getMaxVotepass()});
        })
    }

    votepass(user){
        if(this.state === 'running' && (user.votepass === undefined || !user.votepass))
            user.votepass = true;
        else
            user.votepass = false;
        this.updateVotepass()
    }

    join(user, msg = 'Joined existing channel'){

        if(this.isFull()){
            user.emit('play', {code: 403, 'message': 'This channel is full.'});
            return;
        }

        this.users.push(user);
        user.emit('play', {code: 200, 'message': msg});
        user.channel = this;
        user.live = 0;
        user.score = 0;
        user.word = "";
        this.chat(undefined, '[+] ' + user.name);

        if(this.state === 'waiting' || this.state === 'launching'){
            this.inGame = this.users.slice();
        }
    }

    win(user){
        this.lastWinner = user.name;
        user.score += 3;
        if(this.sequence !== undefined)
            this.chat(undefined, user.name + ' remporte la partie grâce à la séquence \''+this.sequence.sequence+'\'. (Le mot \'' + this.sequence.word + '\' aurait été possible)');

        this.reset();
    }

    quit(user){
        this.getUsers().splice(this.getUsers().indexOf(user), 1);

        if(this.state === 'waiting' || this.state === 'launching'){
            this.inGame = this.users.slice();
        }
        this.chat(undefined, '[-] ' + user.name);

        if(this.getOwner() === user){
            if(this.getUsers().length !== 0){
                this.setOwner(this.getUsers()[0]);
                this.privateChat(undefined, this.getOwner(), "You are the new host.");
            }
        }
        if(this.getUsers().length === 0)
            this.getUsers().splice(this.getUsers().indexOf(this), 1);

        user.channel = undefined;
        user.live = 0;

    }

    chat(sender, message){
        if(message.length == 0 && message.length > 200)
            return;
        this.users.forEach( (user) => {
            user.emit('chat message', {message: message, design: (sender === undefined ? undefined : sender.design), sender: (sender === undefined ? '' : sender.name)});
        });
    }

    privateChat(sender, receiver, message){
        receiver.emit('chat message', {message: message, sender: (sender === undefined ? '' : sender.name)});
    }


    run(tick){

        switch (this.state) {
            case 'waiting':
                if(this.users.length >= 2){
                    this.state = 'launching';
                    this.update();
                }
                break;
            case 'launching':
                if(this.users.length < 2){
                    this.state = 'waiting';
                    this.update();
                }else if(--this.timer <= 0) {
                    this.start();
                }else{
                    this.playAllSound("start_in")
                    this.update();
                }
                break;
            case 'running':
                let inLive = 0;
                for(let user of this.inGame)
                    if(user.live > 0)
                        ++inLive;
                if(inLive == 1){
                    for(let user of this.inGame)
                        if(user.live > 0)
                            this.win(user);
                 }else if(inLive == 0){
                    this.state = 'waiting';
                    this.update();
                }else if(--this.timer <= 0) {
                    let user = this.inGame[this.index];
                    if(user !== undefined && this.removeLive) {
                        --user.live;
                        if(user.live === 0){
                            if(inLive === 3)
                                user.score += 1;
                            else if(inLive === 2)
                                user.score += 2;

                        }
                        user.explosion = 1;
                    }
                    this.nextRound();
                }else{
                    this.update();
                }
                break;
            default:
                break;
        }
    }

};