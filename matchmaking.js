class MatchmakingManager {
    constructor() {
        this.queues = new Map(); // gameType -> array of waiting players
    }

    addToQueue(socket, gameType, difficulty = null) {
        if (!this.queues.has(gameType)) {
            this.queues.set(gameType, []);
        }

        const queue = this.queues.get(gameType);

        // Check if player already in queue
        const existingIndex = queue.findIndex(p => p.id === socket.id);
        if (existingIndex !== -1) {
            return; // Already in queue
        }

        queue.push({
            socket,
            id: socket.id,
            difficulty,
            joinedAt: Date.now()
        });

        console.log(`Added ${socket.id} to ${gameType} queue. Queue size: ${queue.length}`);
    }

    findMatch(gameType, playerCount = 2) {
        const queue = this.queues.get(gameType);

        if (!queue || queue.length < playerCount) {
            return null;
        }

        // Take the specified number of players
        const players = [];
        for (let i = 0; i < playerCount; i++) {
            players.push(queue.shift());
        }

        console.log(`Matched ${players.length} players for ${gameType}`);

        return {
            players: players.map(p => p.socket)
        };
    }

    removeFromQueue(socketId) {
        this.queues.forEach((queue, gameType) => {
            const index = queue.findIndex(p => p.id === socketId);
            if (index !== -1) {
                queue.splice(index, 1);
                console.log(`Removed ${socketId} from ${gameType} queue`);
            }
        });
    }

    getQueueSize(gameType) {
        const queue = this.queues.get(gameType);
        return queue ? queue.length : 0;
    }
}

export const matchmakingManager = new MatchmakingManager();
