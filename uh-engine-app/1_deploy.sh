echo "---------------------------------------------------------"
echo "Building and deploying the Unified Honey Engine App..."
echo "---------------------------------------------------------"
cd "c:\Users\carla\unified-honey\uh-engine-app\uh-engine-app" && docker buildx build --no-cache --platform=linux/amd64 -t goistmo-uswest.registry.snowflakecomputing.com/uh_engine_app_database/public/images/uh_engine_app_service ./service
echo "---------------------------------------------------------"
echo "Pushing the Unified Honey Engine App to the Snowflake Image Registry..."
echo "---------------------------------------------------------"
cd c:/Users/carla/unified-honey/uh-engine-app/uh-engine-app && snow spcs image-registry login && docker image push goistmo-uswest.registry.snowflakecomputing.com/uh_engine_app_database/public/images/uh_engine_app_service
echo "---------------------------------------------------------"
echo "Tearing down the Unified Honey Engine App..."
echo "---------------------------------------------------------"
cd "c:\Users\carla\unified-honey\uh-engine-app\uh-engine-app" && snow app teardown --cascade --force 
echo "---------------------------------------------------------"
echo "Running the Unified Honey Engine App..."
echo "---------------------------------------------------------"
snow app run 2>/dev/null
echo "---------------------------------------------------------"
echo "Unified Honey Engine App deployed successfully"
echo "---------------------------------------------------------"