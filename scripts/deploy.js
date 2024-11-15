require('dotenv').config();

async function main() {
  const TestToken = await ethers.getContractFactory("TestToken");
  const token = await TestToken.deploy("Test Token 2", "TEST2"); //edit before deploy
  await token.deployed();
  console.log("Token deployed to:", token.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });