class UserManager {
    constructor() {
        // Map of userId -> { name, avatar, socketId, status ('online'|'offline'|'playing'), friends: Set<userId> }
        this.users = new Map();

        // Secondary index to quickly find users by socketId
        this.socketToUserId = new Map();
    }

    /**
     * Authenticates/Logs in a user session with data from the database
     */
    loginUser(dbUser, socketId) {
        if (!dbUser || !dbUser.id) return null;

        let user = this.users.get(dbUser.id);

        if (!user) {
            // First time seeing this user this session
            user = {
                name: dbUser.username,
                avatar: dbUser.avatar || '👤', // Default fallback
                socketId,
                status: 'online',
                friends: new Set(),
                wins: dbUser.wins,
                rating: dbUser.rating
            };
            this.users.set(dbUser.id, user);
        } else {
            // Returning user - update their connection info and stats
            user.name = dbUser.username;
            user.avatar = dbUser.avatar || user.avatar;
            user.socketId = socketId;
            user.wins = dbUser.wins;
            user.rating = dbUser.rating;
            // Only update to online if they were disconnected, respect manual 'offline' choice
            if (user.status === 'offline' && socketId) {
                user.status = 'online';
            }
        }

        if (socketId) {
            this.socketToUserId.set(socketId, dbUser.id);
        }
        return user;
    }

    /**
     * Handles when a socket disconnects. We don't delete the user to preserve their friends list,
     * we just mark them offline and remove the socket mapping.
     */
    disconnectUser(socketId) {
        const userId = this.socketToUserId.get(socketId);
        if (!userId) return null;

        const user = this.users.get(userId);
        if (user) {
            user.socketId = null;
            user.status = 'offline';
        }

        this.socketToUserId.delete(socketId);
        return userId;
    }

    /**
     * Finds a user by their exact name (case-insensitive for convenience)
     */
    findUserByName(name) {
        const searchName = name.trim().toLowerCase();
        for (const [userId, user] of this.users.entries()) {
            if (user.name.toLowerCase() === searchName) {
                return userId;
            }
        }
        return null;
    }

    /**
     * Adds a bi-directional friend connection
     * Returns { success: boolean, message?: string, friendId?: string, requesterId?: string }
     */
    addFriendByName(requesterSocketId, friendName) {
        const requesterId = this.socketToUserId.get(requesterSocketId);
        if (!requesterId) return { success: false, message: "You are not authenticated" };

        const requester = this.users.get(requesterId);

        if (requester.name.toLowerCase() === friendName.trim().toLowerCase()) {
            return { success: false, message: "You cannot add yourself as a friend" };
        }

        const friendId = this.findUserByName(friendName);
        if (!friendId) return { success: false, message: "User not found" };

        const friend = this.users.get(friendId);

        // Bi-directional add
        requester.friends.add(friendId);
        friend.friends.add(requesterId);

        return { success: true, requesterId, friendId };
    }

    /**
     * Updates the user's manual presence status
     */
    updateStatus(socketId, newStatus) {
        const userId = this.socketToUserId.get(socketId);
        if (!userId) return null;

        const user = this.users.get(userId);
        if (user) {
            user.status = newStatus;
            return userId;
        }
        return null;
    }

    getUserIdBySocket(socketId) {
        return this.socketToUserId.get(socketId);
    }

    getUserBySocket(socketId) {
        const userId = this.getUserIdBySocket(socketId);
        return userId ? this.users.get(userId) : null;
    }

    getUser(userId) {
        return this.users.get(userId);
    }

    /**
     * Generates a payload of all a user's friends with their current live status
     */
    getFriendsData(userId) {
        const user = this.users.get(userId);
        if (!user) return [];

        const friendsList = [];
        for (const friendId of user.friends) {
            const f = this.users.get(friendId);
            if (f) {
                friendsList.push({
                    id: friendId,
                    name: f.name,
                    avatar: f.avatar,
                    status: f.status
                });
            }
        }
        return friendsList;
    }

    // Stats and Leaderboard logic removed - handled directly via database.js
}

module.exports = UserManager;
