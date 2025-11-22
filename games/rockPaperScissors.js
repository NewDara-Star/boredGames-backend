const CHOICES = ['rock', 'paper', 'scissors'];

const WINS_AGAINST = {
    rock: 'scissors',
    paper: 'rock',
    scissors: 'paper'
};

export class RockPaperScissorsGame {
    constructor(roomId, player1Id, player2Id) {
        this.roomId = roomId;
        this.player1 = player1Id;
        this.player2 = player2Id;
        this.currentRound = 1;
        this.maxRounds = 3;
        this.scores = { [player1Id]: 0, [player2Id]: 0 };
        this.choices = {};
        this.gameOver = false;
        this.winner = null;
    }

    makeChoice(playerId, choice) {
        // Validate choice
        if (!CHOICES.includes(choice)) {
            return { error: 'Invalid choice' };
        }

        if (this.gameOver) {
            return { error: 'Game is already over' };
        }

        if (playerId !== this.player1 && playerId !== this.player2) {
            return { error: 'Invalid player' };
        }

        if (this.choices[playerId]) {
            return { error: 'Choice already made for this round' };
        }

        // Store choice
        this.choices[playerId] = choice;

        // Check if both players have chosen
        if (Object.keys(this.choices).length === 2) {
            return this.resolveRound();
        }

        return {
            success: true,
            waiting: true,
            message: 'Waiting for opponent'
        };
    }

    resolveRound() {
        const p1Choice = this.choices[this.player1];
        const p2Choice = this.choices[this.player2];

        let roundWinner = null;

        // Determine round winner
        if (p1Choice === p2Choice) {
            // Tie
            roundWinner = null;
        } else if (WINS_AGAINST[p1Choice] === p2Choice) {
            // Player 1 wins
            roundWinner = this.player1;
            this.scores[this.player1]++;
        } else {
            // Player 2 wins
            roundWinner = this.player2;
            this.scores[this.player2]++;
        }

        // Check if game is over (best of 3)
        const p1Score = this.scores[this.player1];
        const p2Score = this.scores[this.player2];

        if (p1Score === 2 || p2Score === 2 || this.currentRound === 3) {
            this.gameOver = true;
            if (p1Score > p2Score) {
                this.winner = this.player1;
            } else if (p2Score > p1Score) {
                this.winner = this.player2;
            }
            // else it's a tie (1-1-1)
        }

        const result = {
            success: true,
            roundComplete: true,
            roundWinner,
            choices: {
                [this.player1]: p1Choice,
                [this.player2]: p2Choice
            },
            scores: this.scores,
            currentRound: this.currentRound,
            gameOver: this.gameOver,
            winner: this.winner
        };

        // Prepare for next round
        if (!this.gameOver) {
            this.currentRound++;
            this.choices = {};
        }

        return result;
    }

    reset() {
        this.currentRound = 1;
        this.scores = { [this.player1]: 0, [this.player2]: 0 };
        this.choices = {};
        this.gameOver = false;
        this.winner = null;
    }

    getState() {
        return {
            currentRound: this.currentRound,
            scores: this.scores,
            gameOver: this.gameOver,
            winner: this.winner,
            waitingForChoices: Object.keys(this.choices).length < 2
        };
    }
}
