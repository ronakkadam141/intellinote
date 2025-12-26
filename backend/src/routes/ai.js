const router = require("express").Router();

router.get("/", (req, res) => {
  res.send("AI route working");
});

module.exports = router;