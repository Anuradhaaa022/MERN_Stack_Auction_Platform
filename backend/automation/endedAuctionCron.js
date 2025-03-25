import cron from "node-cron";
import { Auction } from "../models/auctionSchema.js";
import { User } from "../models/userSchema.js";
import { Bid } from "../models/bidSchema.js";
import { sendEmail } from "../utils/sendEmail.js";
import { calculateCommission } from "../controllers/commissionController.js";

export const endedAuctionCron = () => {
  cron.schedule("*/1 * * * *", async () => {
    try {
      const now = new Date();
      console.log("Cron for ended auction running...");
      
      const endedAuctions = await Auction.find({
        endTime: { $lt: now },
        commissionCalculated: false,
      });

      for (const auction of endedAuctions) {
        try {
          console.log(`Processing auction: ${auction.title}`);

          const commissionAmount = await calculateCommission(auction._id);
          auction.commissionCalculated = true;

          const highestBidder = await Bid.findOne({
            auctionItem: auction._id,
            amount: auction.currentBid,
          });

          if (!highestBidder) {
            console.log(`❌ No highest bidder found for auction: ${auction.title}`);
            await auction.save(); // Save updated auction status
            continue; // Skip this auction safely
          }

          console.log(`✅ Found highest bidder: ${highestBidder.bidder?.id}`);

          const bidder = await User.findById(highestBidder.bidder?.id);
          if (!bidder) {
            console.log(`❌ Winner user not found for ID: ${highestBidder.bidder?.id}`);
            continue; // Skip this auction safely
          }

          const auctioneer = await User.findById(auction.createdBy);
          if (!auctioneer) {
            console.log(`❌ Auctioneer not found for auction: ${auction.title}`);
            continue;
          }

          // Ensure auctioneer has the commission updated
          await User.findByIdAndUpdate(
            auctioneer._id,
            { $inc: { unpaidCommission: commissionAmount } },
            { new: true }
          );

          // 📨 Send email to auctioneer about unpaid commission
          const auctioneerSubject = `Unpaid Commission Notice for Auction: ${auction.title}`;
          const auctioneerMessage = `Dear ${auctioneer.userName},\n\n` +
            `You have an **unpaid commission of ₹${commissionAmount}** for the auction "${auction.title}".\n` +
            `Please ensure payment is completed within **24 hours** to avoid penalties.\n\n` +
            `**Payment Methods:**\n` +
            `1. **Bank Transfer**:\n` +
            `   - Account Name: Zeeshu Auction Team\n` +
            `   - Account Number: XXXX-XXXX-XXXX\n` +
            `   - Bank: XYZ Bank\n\n` +
            `2. **PayPal**:\n` +
            `   - Send payment to: payments@zeeshuauction.com\n\n` +
            `For any queries, contact support at **support@zeeshuauction.com**.\n\n` +
            `Best regards,\nZeeshu Auction Team`;

          console.log(`📩 Sending email to auctioneer (${auctioneer.email}) regarding unpaid commission...`);
          await sendEmail({ email: auctioneer.email, subject: auctioneerSubject, message: auctioneerMessage });
          console.log("✅ Successfully sent unpaid commission email to auctioneer.");

          auction.highestBidder = highestBidder.bidder.id;
          await auction.save();

          await User.findByIdAndUpdate(
            bidder._id,
            {
              $inc: {
                moneySpent: highestBidder.amount,
                auctionsWon: 1,
              },
            },
            { new: true }
          );

          const subject = `Congratulations! You won the auction for ${auction.title}`;
          const message = `Dear ${bidder.userName}, \n\nCongratulations! You have won the auction for ${auction.title}. \n\nBefore proceeding for payment, contact your auctioneer via email: ${auctioneer.email} \n\nPlease complete your payment using one of the following methods:\n\n1. **Bank Transfer**: \n- Account Name: ${auctioneer.paymentMethods?.bankTransfer?.bankAccountName || "Not Available"} \n- Account Number: ${auctioneer.paymentMethods?.bankTransfer?.bankAccountNumber || "Not Available"} \n- Bank: ${auctioneer.paymentMethods?.bankTransfer?.bankName || "Not Available"}\n\n2. **UPI ID**:\n- You can send payment via UPI: ${auctioneer.paymentMethods?.upi?.upiID || "Not Available"}\n\n3. **PayPal**:\n- Send payment to: ${auctioneer.paymentMethods?.paypal?.paypalEmail || "Not Available"}\n\n4. **Cash on Delivery (COD)**:\n- If you prefer COD, you must pay 20% of the total amount upfront before delivery.\n- To pay the 20% upfront, use any of the above methods.\n- The remaining 80% will be paid upon delivery.\n- If you want to see the condition of your auction item, send an email to: ${auctioneer.email}\n\nPlease ensure your payment is completed by [Payment Due Date]. Once we confirm the payment, the item will be shipped to you.\n\nThank you for participating!\n\nBest regards,\nZeeshu Auction Team`;

          console.log("📧 SENDING EMAIL TO HIGHEST BIDDER");
          console.log(`Attempting to send email to: ${bidder.email}`);

          await sendEmail({ email: bidder.email, subject, message });

          console.log("✅ SUCCESSFULLY SENT EMAIL TO HIGHEST BIDDER");
        } catch (error) {
          console.error("❌ Error processing auction:", error.message);
        }
      }
    } catch (error) {
      console.error("❌ Error in ended auction cron:", error.message);
    }
  });
};
