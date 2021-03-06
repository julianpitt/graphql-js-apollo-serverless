const URL = require('url');
const pubsub = require('../pubsub');
const ObjectID = require('mongodb').ObjectID;

class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.field = field;
  }
}

function assertValidLink ({url}) {
    var urlRegex = '^(?!mailto:)(?:(?:http|https|ftp)://)(?:\\S+(?::\\S*)?@)?(?:(?:(?:[1-9]\\d?|1\\d\\d|2[01]\\d|22[0-3])(?:\\.(?:1?\\d{1,2}|2[0-4]\\d|25[0-5])){2}(?:\\.(?:[0-9]\\d?|1\\d\\d|2[0-4]\\d|25[0-4]))|(?:(?:[a-z\\u00a1-\\uffff0-9]+-?)*[a-z\\u00a1-\\uffff0-9]+)(?:\\.(?:[a-z\\u00a1-\\uffff0-9]+-?)*[a-z\\u00a1-\\uffff0-9]+)*(?:\\.(?:[a-z\\u00a1-\\uffff]{2,})))|localhost)(?::\\d{2,5})?(?:(/|\\?|#)[^\\s]*)?$';
    var urlParsed = new RegExp(urlRegex, 'i');
    if(!(url.length < 2083 && urlParsed.test(url))) {
        throw new ValidationError('Link validation error: invalid url.', 'url');
    }
}

function buildFilters({OR = [], description_contains, url_contains}) {
    
    const filter = (description_contains || url_contains) ? {} : null;

    if (description_contains) {
      filter.description = {$regex: `.*${description_contains}.*`};
    }

    if (url_contains) {
      filter.url = {$regex: `.*${url_contains}.*`};
    }
  
    let filters = filter ? [filter] : [];

    for (let i = 0; i < OR.length; i++) {
      filters = filters.concat(buildFilters(OR[i]));
    }

    return filters;
  }



module.exports = {

  Subscription: {
    Vote: {
      subscribe: () => pubsub.asyncIterator('Vote'),
    },
    Link: {
      subscribe: () => pubsub.asyncIterator('Link'),
    },
    Test: {
      subscribe: () => pubsub.asyncIterator('Test'),
    },
  },

  Query: {
    allLinks: (root, {filter, first, skip}, {mongo: {Links}}) => {
      let query = filter ? {$or: buildFilters(filter)} : {};
      const cursor = Links.find(query);
      if (first) {
          cursor.limit(first);
      }
      if (skip) {
          cursor.skip(skip);
      }
      return cursor.toArray();
    },

    allVotes: (root, data, {mongo: {Votes}}) => { // 1
      return Votes.find({}).toArray(); // 2
    },

    allTests: (root, data, {mongo: {Tests}}) => { // 1
      return Tests.find({}).toArray(); // 2
    },
  },

  Mutation: {

    createTest: (root, data, {mongo: {Tests}}) => {

        const newTest = {
            test: data.test,
            linkId: new ObjectID(data.linkId),
        };
        return Tests.insert(newTest).then((response) => {
            
            console.log('response', response.ops[0]);
            pubsub.publish('Test', {Test: {mutation: 'CREATED', node: response.ops[0]}});

            return response.ops[0];
        });
    
    },

    createLink: (root, data, {mongo: {Links}, user}) => {
        assertValidLink(data);
        const newLink = Object.assign({postedById: user && user._id}, data);
        return Links.insert(newLink).then((response) => {
            
            newLink.id = response.insertedIds[0];            
            console.log(newLink);
            pubsub.publish('Link', {Link: {mutation: 'CREATED', node: newLink}});

            return newLink;
        });
    
    },

    createUser: (root, data, {mongo: {Users}}) => {
        // You need to convert the given arguments into the format for the
        // `User` type, grabbing email and password from the "authProvider".
        const newUser = {
            name: data.name,
            email: data.authProvider.credentials.email,
            password: data.authProvider.credentials.password,
        };

        return Users.insert(newUser).then((response) => {
            return Object.assign({id: response.insertedIds[0]}, newUser);
        });
    },

    signinUser: (root, data, {mongo: {Users}}) => {
        return Users.findOne({email: data.credentials.email}).then((user) => {
            if (data.credentials.password === user.password) {
                return {token: `token-${user.email}`, user};
            }
        });
    },

    createVote: (root, data, {mongo: {Votes}, user}) => {
        const newVote = {
            userId: user && user._id,
            linkId: new ObjectID(data.linkId),
        };
        return Votes.insert(newVote).then((response) => {

            newVote.id = response.insertedIds[0];
            console.log(newVote);
            pubsub.publish('Vote', {Vote: {mutation: 'CREATED', node: newVote}});

            return newVote;
        });
    },

    removeAll: (root, data, {mongo: {Votes,Users,Links}}) => {
        return Votes.remove().then(() => Users.remove()).then(() => Links.remove());
    },

    removeAllLinks: (root, data, {mongo: {Votes,Links}}) => {
        return Votes.remove().then(() => Links.remove());
    },

    removeAllTests: (root, data, {mongo: {Tests}}) => {
        return Tests.remove();
    }

},

    Link: {
        id: root => root._id || root.id, // 5
        postedBy: ({postedById}, data, {dataloaders: {userLoader}}) => {
            return userLoader.load(postedById);
        },
        votes: ({_id}, data, {mongo: {Votes}}) => {
            return Votes.find({linkId: _id}).toArray();
        },
    },
    User: {
        // Convert the "_id" field from MongoDB to "id" from the schema.
        id: root => root._id || root.id,
        votes: ({_id}, data, {mongo: {Votes}}) => {
            return Votes.find({userId: _id}).toArray();
        },
    },
    Vote: {
        id: root => root._id || root.id,

        user: ({userId}, data, {dataloaders: {userLoader}}) => {
            return userLoader.load(userId);
        },

        link: ({linkId}, data, {mongo: {Links}}) => {
            return Links.findOne({_id: linkId});
        },
    },
    Test: {
        id: root => root._id || root.id,

        link: ({linkId}, data, {mongo: {Links}}) => {
            // This wont work for subscriptions
            return Links.findOne({_id: linkId});
        },
    }
};