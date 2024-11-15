require('dotenv').config();

async function main() {
    const TestToken = await ethers.getContractFactory("TestToken");
    const token = await TestToken.attach(process.env.TOKEN_ADDRESS);
    
    const mintAmount = ethers.utils.parseEther("1000");
    const tx = await token.mint(process.env.RECIPIENT_ADDRESS, mintAmount);
    await tx.wait();
    
    console.log("Minted tokens successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });