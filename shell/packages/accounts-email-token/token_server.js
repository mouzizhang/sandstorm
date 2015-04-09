var TOKEN_EXPIRATION_MS = 15 * 60 * 1000;

var cleanupExpiredTokens = function() {
  Meteor.users.update({}, {
    $pull: {
      "services.emailToken.tokens": {
        createdAt: {$lt: new Date(Date.now() - TOKEN_EXPIRATION_MS)}
      }
    }
  }, { multi: true });
};

Meteor.startup(cleanupExpiredTokens);
// Tokens can actually last up to 2 * TOKEN_EXPIRATION_MS
Meteor.setInterval(cleanupExpiredTokens, TOKEN_EXPIRATION_MS);

Accounts._checkToken = function (user, token) {
  var found = false;
  user.services.emailToken.tokens.forEach(function (userToken) {
    if((userToken.algorithm === token.algorithm) &&
       (userToken.digest === token.digest)) {
      found = true;
    }
  });

  return found;
};
var checkToken = Accounts._checkToken;

// Handler to login with a token.
Accounts.registerLoginHandler("emailToken", function (options) {
  if (!options.emailToken)
    return undefined; // don't handle

  options = options.emailToken;
  check(options, {
    email: String,
    token: String
  });

  var user = Meteor.users.findOne({"services.emailToken.email": options.email});

  if (!user) {
    console.error("User not found:", options.email);
    return {
      error: new Meteor.Error(403, "User not found")
    };
  }

  if (!user.services || !user.services.emailToken ||
      !(user.services.emailToken.tokens)) {
    console.error("User has no token set:", options.email);
    return {
      error: new Meteor.Error(403, "User has no token set")
    };
  }

  var token = Accounts._hashToken(options.token);
  var found = checkToken(
    user,
    token
  );

  if (!found) {
    console.error("Token not found:", user.services.emailToken);
    return {
      error: new Meteor.Error(403, "Token not found")
    };
  }

  Meteor.users.update({_id: user._id}, {$pull: {"services.emailToken.tokens": token}});
  return {
    userId: user._id
  };
});

var Url = Npm.require("url");

var ROOT_URL = Url.parse(process.env.ROOT_URL);
var HOSTNAME = ROOT_URL.hostname;

var makeTokenUrl = function (email, token) {
  return process.env.ROOT_URL + "/_emailToken/" + encodeURIComponent(email) + "/" + encodeURIComponent(token);
};

///
/// EMAIL VERIFICATION
///
var sendTokenEmail = function (email, token) {
  var options = {
    to:  email,
    from: "Sandstorm " + HOSTNAME + " <no-reply@" + HOSTNAME + ">",
    subject: "Sandstorm token for " + HOSTNAME,
    text: "A token has requested on your behalf to login to a Sandstorm instance at " + HOSTNAME +
      ". You will need to either navigate to " + makeTokenUrl(email, token) + " or manually copy " +
      token + " into the login dropdown."
  };

  Email.send(options);
};

///
/// CREATING USERS
///
// returns the user id
var createAndEmailTokenForUser = function (email) {
  // Unknown keys allowed, because a onCreateUserHook can take arbitrary
  // options.
  check(email, String);

  var user = Meteor.users.findOne({"services.emailToken.email": email});
  var userId;

  // TODO(someday): make this shorter, and handle requests that try to brute force it.
  var token = Random.id(12);
  var tokenObj = Accounts._hashToken(token);
  tokenObj.createdAt = new Date();

  if (user) {
    if (user.services.emailToken.tokens && user.services.emailToken.tokens.length > 2) {
      throw new Meteor.Error(403, "Too many tokens have been made for this user. Please find the " +
        "token in your email, or wait a bit to try again.");
    }
    userId = user._id;

    Meteor.users.update({_id: userId}, {$push: {"services.emailToken.tokens": tokenObj}});
  } else {
    var options = {
      email: email,
      profile: {
        name: email
      }
    };

    user = {services: {emailToken: {
      tokens: [tokenObj],
      email: options.email
    }}};

    userId = Accounts.insertUserDoc(options, user);
  }

  sendTokenEmail(email, token);

  return userId;
};

// method for create user. Requests come from the client.
// This method will create a user if it doesn't exist, otherwise it will generate a token.
// It will always send an email to the user
Meteor.methods({createAndEmailTokenForUser: function (email) {
  if (!Accounts.isEmailTokenLoginEnabled()) {
    throw new Meteor.Error(403, "Email Token service is disabled.");
  }
  // Create user. result contains id and token.
  var user = createAndEmailTokenForUser(email);
}});

///
/// INDEXES ON USERS
///
Meteor.users._ensureIndex("services.emailToken.email",
                          {unique: 1, sparse: 1});
