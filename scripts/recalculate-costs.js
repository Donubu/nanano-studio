/**
 * Script to recalculate estimated costs for all existing messages
 * Based on token counts, image sizes, and video duration
 * Uses the pricing configured in the models table
 *
 * Run with: node scripts/recalculate-costs.js
 */

const mysql = require('mysql2/promise');

const dbConfig = {
  host: process.env.DB_HOST || 'host.docker.internal',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '121314',
  database: process.env.DB_NAME || 'nanano',
};

async function recalculateCosts() {
  console.log('🔄 Starting cost recalculation...\n');

  const connection = await mysql.createConnection(dbConfig);

  try {
    // Get all models with their pricing
    const [models] = await connection.execute(`
      SELECT id, model_id, display_name,
             cost_input_per_million, cost_output_per_million,
             cost_image_1k, cost_image_2k, cost_image_4k,
             cost_video_per_second
      FROM models
    `);

    console.log(`📊 Found ${models.length} models with pricing:\n`);
    for (const model of models) {
      const hasAnyCost = parseFloat(model.cost_input_per_million) > 0 ||
                         parseFloat(model.cost_output_per_million) > 0 ||
                         parseFloat(model.cost_image_1k) > 0 ||
                         parseFloat(model.cost_video_per_second) > 0;

      if (hasAnyCost) {
        console.log(`  - ${model.display_name}:`);
        if (parseFloat(model.cost_input_per_million) > 0)
          console.log(`    Input: $${model.cost_input_per_million}/M tokens`);
        if (parseFloat(model.cost_output_per_million) > 0)
          console.log(`    Output: $${model.cost_output_per_million}/M tokens`);
        if (parseFloat(model.cost_image_1k) > 0)
          console.log(`    Image 1K: $${model.cost_image_1k}`);
        if (parseFloat(model.cost_image_2k) > 0)
          console.log(`    Image 2K: $${model.cost_image_2k}`);
        if (parseFloat(model.cost_image_4k) > 0)
          console.log(`    Image 4K: $${model.cost_image_4k}`);
        if (parseFloat(model.cost_video_per_second) > 0)
          console.log(`    Video: $${model.cost_video_per_second}/sec`);
      }
    }
    console.log('');

    // Get all messages with their conversation's model
    const [messages] = await connection.execute(`
      SELECT m.id, m.conversation_id, m.role, m.tokens_input, m.tokens_output,
             m.image_url, m.image_size, m.video_url, m.video_duration,
             c.model_id as conversation_model_id
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE m.role = 'model'
    `);

    console.log(`📝 Processing ${messages.length} model messages...\n`);

    let totalUpdated = 0;
    let totalCost = 0;
    const conversationCosts = {};

    for (const message of messages) {
      // Find the model for this conversation
      const model = models.find(m => m.id === message.conversation_model_id);
      if (!model) {
        continue;
      }

      let estimatedCost = 0;

      // Token costs
      const tokensInput = message.tokens_input || 0;
      const tokensOutput = message.tokens_output || 0;

      if (tokensInput > 0 && parseFloat(model.cost_input_per_million) > 0) {
        estimatedCost += (tokensInput / 1_000_000) * parseFloat(model.cost_input_per_million);
      }
      if (tokensOutput > 0 && parseFloat(model.cost_output_per_million) > 0) {
        estimatedCost += (tokensOutput / 1_000_000) * parseFloat(model.cost_output_per_million);
      }

      // Image costs
      if (message.image_url) {
        const imageSize = message.image_size || '1K';
        switch (imageSize) {
          case '4K':
            estimatedCost += parseFloat(model.cost_image_4k) || parseFloat(model.cost_image_2k) || parseFloat(model.cost_image_1k) || 0;
            break;
          case '2K':
            estimatedCost += parseFloat(model.cost_image_2k) || parseFloat(model.cost_image_1k) || 0;
            break;
          case '1K':
          default:
            estimatedCost += parseFloat(model.cost_image_1k) || 0;
            break;
        }
      }

      // Video costs
      if (message.video_url && message.video_duration) {
        const videoDuration = parseFloat(message.video_duration) || 0;
        if (videoDuration > 0 && parseFloat(model.cost_video_per_second) > 0) {
          estimatedCost += videoDuration * parseFloat(model.cost_video_per_second);
        }
      }

      // Round to 6 decimal places
      estimatedCost = Math.round(estimatedCost * 1_000_000) / 1_000_000;

      if (estimatedCost > 0) {
        // Update message
        await connection.execute(
          'UPDATE messages SET estimated_cost = ? WHERE id = ?',
          [estimatedCost, message.id]
        );

        totalUpdated++;
        totalCost += estimatedCost;

        // Track conversation totals
        if (!conversationCosts[message.conversation_id]) {
          conversationCosts[message.conversation_id] = 0;
        }
        conversationCosts[message.conversation_id] += estimatedCost;
      }
    }

    console.log(`✅ Updated ${totalUpdated} messages with costs\n`);

    // Update conversation totals
    console.log(`💬 Updating ${Object.keys(conversationCosts).length} conversation totals...\n`);

    for (const [conversationId, cost] of Object.entries(conversationCosts)) {
      const roundedCost = Math.round(cost * 1_000_000) / 1_000_000;
      await connection.execute(
        'UPDATE conversations SET total_estimated_cost = ? WHERE id = ?',
        [roundedCost, conversationId]
      );
    }

    console.log('📊 Summary:');
    console.log(`   Messages updated: ${totalUpdated}`);
    console.log(`   Conversations updated: ${Object.keys(conversationCosts).length}`);
    console.log(`   Total estimated cost: $${totalCost.toFixed(4)}`);
    console.log('');

    // Show breakdown by model
    console.log('📈 Cost breakdown by model:');
    const [breakdown] = await connection.execute(`
      SELECT m.display_name,
             COUNT(msg.id) as message_count,
             SUM(msg.estimated_cost) as total_cost
      FROM messages msg
      JOIN conversations c ON msg.conversation_id = c.id
      JOIN models m ON c.model_id = m.id
      WHERE msg.role = 'model' AND msg.estimated_cost > 0
      GROUP BY m.id, m.display_name
      ORDER BY total_cost DESC
    `);

    for (const row of breakdown) {
      console.log(`   ${row.display_name}: ${row.message_count} messages, $${parseFloat(row.total_cost).toFixed(4)}`);
    }

    console.log('\n✨ Cost recalculation complete!');

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await connection.end();
  }
}

recalculateCosts().catch(console.error);
