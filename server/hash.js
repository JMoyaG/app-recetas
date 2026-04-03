import bcrypt from "bcryptjs";

const password = "123";

bcrypt.hash(password, 10).then((hash) => {
  console.log("HASH:", hash);
});