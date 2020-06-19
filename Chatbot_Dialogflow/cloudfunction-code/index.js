'use strict';
 
const https = require('https');
const functions = require('firebase-functions');
const {WebhookClient} = require('dialogflow-fulfillment');
const {Card, Suggestion} = require('dialogflow-fulfillment');
const {Suggestions, Permission, List} = require('actions-on-google');
 
exports.dialogflowFirebaseFulfillment = functions.https.onRequest((request, response) => {
  const agent = new WebhookClient({ request, response });
  
  //Gets the query parameters
  const query = getQuery();  
  
  //mapped to Default Welcome intent
  function welcome(agent) {
	if(!agent.context.get('expire_context') && agent.context.get('flight_context')){
		agent.context.set({'name': 'flight_context', 'lifespan': -1});
	}
	addWelcomeOptions(agent);
	agent.add(new Suggestion(`Auto detect loc`));
  }
  
  //mapped to Loc - AskForPermission intent
  function askPermissionForLoc(agent){
	const conv = agent.conv(); 
	conv.data.requestedPermission = 'DEVICE_PRECISE_LOCATION';
	conv.ask(new Permission({
        context: 'to locate you',
        permissions: conv.data.requestedPermission,
    }));
	agent.add(conv);
  }
  
  //mapped to Loc - GetCity intent
  function getCity(agent){
	const conv = agent.conv();
	if(conv.device.location && conv.device.location.city){
		agent.context.set({'name': 'loc_context', 'lifespan': 3, 'parameters': {'city': conv.device.location.city}});
		conv.ask('Your source location for flight is detected.');
    }
	conv.ask(`Hi, I am your travel planner, you can ask me to book your flight and hotel rooms`);
	conv.ask(new Suggestions(`Book a flight`));
    conv.ask(new Suggestions(`Book a room`));
	conv.ask(new Suggestions('Auto detect loc'));
	agent.add(conv);
  }
  
  //mapped to BookFlights intent
  function bookFlight(agent) {
	let date = getDate();
  	let sourceCity = getSourceCity();
  	let destCity = getDestCity();
  	let fulfillmentText = getfulfillmentText();
    if(!sourceCity && !destCity && !date){
		agent.add(fulfillmentText);
      	addCitiesToAgent(agent);
    }
    else if(sourceCity && !destCity && !date){
      	agent.add(fulfillmentText);
      	addCitiesToAgent(agent);
    }
    else if(sourceCity && destCity && !date){
		if(sourceCity === destCity){
			agent.add('Destination city should be different. Please update destination');
			agent.add(new Suggestion('Change Destination'));
		}
		else{
			getFlightDate(agent);
		}
    }
  }
  
  //mapped to BookFlights - Select Today - ChangeDate intent
  function getFlightDate(agent){
	agent.add('For when do you want to book flight?');
	addDefaultDatesToAgent(agent);
    agent.add(new Suggestion(`Friday`));  
  }
  
  //mapped to BookFlights - Select Date intent
  function bookFlightSelectDate(agent){
	let date = new Date(getDate());
	let currentDate = new Date();
	let queryText = getQueryText();
	if(queryText.toLowerCase() === 'today' ||
	(date.getDate() === currentDate.getDate()&&
	date.getMonth() === currentDate.getMonth()&&
	date.getYear() === currentDate.getYear()&&
	queryText.toLowerCase() !== 'friday')){
		bookFlightChangeFlow(agent);
	}
	else{
		bookFlightSelectClass(agent);
	}
  }

  //mapped to BookFlights - Select Class intent
  function bookFlightSeat(agent){
	agent.add('Do you want to select seat?');
	yesNoSuggestion(agent);
  }
  
  //mapped to BookFlights - Payment intent
  function bookFlightPayment(agent){
	if(getQueryText().toLowerCase() === 'pay'){
		let request = new Promise((resolve, reject) => {
			https.get('https://reqres.in/api/users/2', function(response){
				let json = "";
				response.on('data', function(chunk){
					json += chunk;
				});
				agent.add('Your payment processing...');
				response.on('end', function(){
					setTimeout(function () {
						agent.setFollowupEvent('payment_delay1'); 
						resolve(json);
					}, 5000);
				});
			})
			.on('error', (err) => {
				agent.add('Your payment failed.');	
				agent.add(new Suggestion('Pay again'));
				agent.context.set({'name': 'selectclass_context', 'lifespan': 1});
				resolve();
			});
		});
		return request;
	}
	else{
		agent.add('Please complete payment by clicking here');
		agent.add(new Suggestion('Pay'));
	}
  }
 
  //mapped to BookFlights - Payment Delay 1 intent
  function paymentDelay1(agent){
	return new Promise((resolve, reject) => {
			agent.add('Payment delay');
			setTimeout(function(){
				agent.setFollowupEvent('payment_delay2');
				resolve();
			}, 6000);
		});
  }
  
  //BookFlights - Payment Delay 2 intent
  function paymentDelay2(agent){
	return new Promise((resolve, reject) => {
			agent.add('Thank you for your payment! \nYour tickets have been booked and your bookingID is ' + Math.random().toString().substr(2,5));
			agent.add('Do you want to book hotel room also?');
			yesNoSuggestion(agent);
			setTimeout(function(){
				agent.context.set({'name': 'expire_context', 'lifespan': 5, 'parameters': {'time': new Date()}});
				resolve();
			}, 6000);
		});
  }
  
  //mapped to BookFlights - Select Seat intent
  function bookFlightSelectSeat(agent){
	let fulfillmentText = getfulfillmentText();
	if(fulfillmentText && fulfillmentText.indexOf('please select your seat for flight') !== -1){
		let seats = ['A1', 'A2', 'A3','A4', 'A5', 'A6', 'B1', 'B2'];
		agent.add(`Please select or type seat mappings as shown`);
		agent.add(new Card({
         title: `Select seat`,
         text: fulfillmentText,
		 imageUrl: 'https://i.ibb.co/RBQfHht/Capture2.png',
		}));
		seats.forEach(seat => agent.add(new Suggestion(seat)));	
	}
	else{
		return bookFlightPayment(agent);			
	}
  }
  
  //mapped to BookHotel intent
  function bookHotel(agent) {
	let date = getDate();
  	let destCity = getSourceCity();
	let hotel = getHotelName();
  	let fulfillmentText = getfulfillmentText();
    if(!destCity && !date && !hotel){
		agent.add(fulfillmentText);
      	addCitiesToAgent(agent);
    }
    else if(destCity && !date && !hotel){
		agent.add(fulfillmentText);
		addDefaultDatesToAgent(agent);
	}
	else if(destCity && date && !hotel){
		returnHotelList(agent);
	}
  }
  
  //mapped to BookHotel - List Select intent
  function bookHotelResponse(agent){
	let hotelContext = agent.context.get('hotel_select_context');
	let selectedHotelContext = agent.context.get('actions_intent_option');
	agent.add('Room booked in ' + selectedHotelContext.parameters.text + ' for ' + hotelContext.parameters.city + ' on ' + hotelContext.parameters.date.split("T")[0]);
	agent.add(new Suggestion('Start over'));
  }
  
  //mapped to BookFlights - BookHotel - Yes intent
  function bookHotelflightFollowup(agent){
	if(getSourceCity() && getDate() && !getHotelName()){
		returnHotelList(agent);
	}
  }
  
  //mapped to BookHotel - FlightContext intent
  function bookHotelflightcontext(agent){
	let expireContext = agent.context.get('expire_context');
	if(expireContext && expireContext.parameters){
		let startTime = new Date(expireContext.parameters.time).getTime();
		let endTime = new Date().getTime();
		let diff = (endTime - startTime)/1000;
		if(diff <= 20){
			agent.add('Do you want to book room for ' + query.parameters['geo-city'] + ' (selected for flight booking)');
			yesNoSuggestion(agent);
		}
		else{
			agent.add('Your 20 sec time window has expired!');
			bookhotelFlightcontextNo(agent);
		}
	}
	else{
		bookhotelFlightcontextNo(agent);
	}
  }
  
  //mapped to BookFlights - BookHotel - No intent
  function bookHotelExpireContext(agent){
	agent.add('End! We are done.');
	agent.add(new Suggestion('Start over'));
  }  
    
  function bookFlightChangeFlow(agent){
    agent.add('No flights are available for today');
	agent.add(new Suggestion(`Change date`));
	standardOptions(agent);
  }
   
  function addWelcomeOptions(agent){
	agent.add(`Hi, I am your travel planner, you can ask me to book your flight and hotel rooms`);
    agent.add(new Suggestion(`Book a flight`));
    agent.add(new Suggestion(`Book a room`));	  
  }	  
	  
  function bookFlightSelectClass(agent){
    agent.add(`Which class you want to travel?`);
	agent.add(new Suggestion(`Economy`));
    agent.add(new Suggestion(`Business`)); 
	standardOptions(agent);
  }
  
  function returnHotelList(agent){
	let conv = agent.conv();
		conv.ask(new List({
			title: 'List of Hotels',
			items: {
				'Taj': {
					title: 'Taj',
					image: {
						url: 'https://image.shutterstock.com/image-vector/sketch-taj-mumbai-india-vector-260nw-770258890.jpg',
						accessibilityText: 'Works With Taj logo',
					}
				},
				'Hyatt': {
					title: 'Hyatt',
					image: {
						url: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRuwJtAExQ2pS6RcQQplSRByHBlMzPJ5RQ75JyZ_7hgyp3J0Trt2A&s',
						accessibilityText: 'Works With Hyatt logo',
					}
				},
				'Oberoi': {
					title: 'Oberoi',
					image: {
						url: 'https://media-exp1.licdn.com/dms/image/C510BAQEvh-W2MAJcPA/company-logo_200_200/0?e=2159024400&v=beta&t=t4XEtGlssF49u_HEgOX_baID9DbFq1o801GQFvBH35o',
						accessibilityText: 'Works With Oberoi logo',
					}
				},
				'Hotel Shangrila': {
					title: 'Hotel Shangrila',
					image: {
						url: 'https://img.favpng.com/9/18/6/island-shangri-la-shangri-la-hotels-and-resorts-png-favpng-K0exJ9SMSXerVLFhyUXy2fnqN.jpg',
						accessibilityText: 'Works With Hotel Shangrila logo',
					}
				},
				'Hotel Crown': {
					title: 'Hotel Crown',
					image: {
						url: 'https://c7.uihere.com/files/259/815/774/crown-perth-crown-melbourne-crown-resorts-hotel-casino-hotel.jpg',
						accessibilityText: 'Works With Hotel Crown logo',
					}
				},
				'Marriott': {
					title: 'Marriott',
					image: {
						url: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTXFgsrpnPTdS7dvKm2P9UPgSWhUmxSLPIYEaAPBXC-gtn1Bv4wsg&s',
						accessibilityText: 'Works With Marriott logo',
					}
				},
				'Clarks Inn': {
					title: 'Clarks Inn',
					image: {
						url: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQAltOAsf1PS6mE_swKZ1Dpr9AiWRUFwHRFY9JU9YXu5coTtlmSPw&s',
						accessibilityText: 'Works With Clarks Inn logo',
					}
				}
			}
		}));
		conv.ask('Please select from below hotels.');
		
		agent.context.set({'name': 'hotel_select_context', 'lifespan': 1, 'parameters': {'city': query.parameters['geo-city'], 'date': query.parameters.date}});
		agent.add(conv);
  }
    
  function yesNoSuggestion(agent){
	agent.add(new Suggestion('Yes'));
	agent.add(new Suggestion('No'));
  }
    
  function standardOptions(agent){
	agent.add(new Suggestion(`Change destination`));
	agent.add(new Suggestion(`Start over`));  
  }
  
  function addDefaultDatesToAgent(agent){
	agent.add(new Suggestion(`Today`));
    agent.add(new Suggestion(`Tomorrow`));
  }
  
  function addCitiesToAgent(agent){
	let cities = ['Delhi','Mumbai','Chennai','Kolkata','Bangalore','Hyderabad'];
	cities.forEach(city => agent.add(new Suggestion(city)));
  }

  function bookhotelFlightcontextNo(agent){
	agent.context.set({'name': 'flight_context', 'lifespan': -1});
	agent.context.set({'name': 'bookhotel_flightcontext_no', 'lifespan': 1});
	agent.add('Please provide destination for Room booking.');
	addCitiesToAgent(agent);
  }
        
  function getHotelName(){
	return query.parameters.hotel_name; 
  }
        
  function getQueryText(){
	return query.queryText; 
  }
    
  function getDate(){
	return query.parameters.date;  
  }
  
  function getSourceCity(){
	return query.parameters['geo-city'];  
  }
  
  function getDestCity(){
	return query.parameters['geo-city1'];  
  }
  
  function getfulfillmentText(){
	return query.fulfillmentText; 
  }
  
  function getQuery(){
	return request.body.queryResult;  
  }

  // Run the proper function handler based on the matched Dialogflow intent name
  let intentMap = new Map();
  intentMap.set('Default Welcome', welcome);
  intentMap.set('Default Welcome Intent', welcome);
  intentMap.set('BookFlights', bookFlight);
  intentMap.set('BookFlights - Select Today - ChangeDate', getFlightDate);
  intentMap.set('BookFlights - Select Today - ChangeDestination', bookFlight);
  intentMap.set('BookFlights - Select Date', bookFlightSelectDate);
  intentMap.set('BookFlights - Select Class', bookFlightSeat);
  intentMap.set('BookFlights - Payment', bookFlightPayment);
  intentMap.set('BookFlights - Select Seat', bookFlightSelectSeat);
  intentMap.set('BookHotel', bookHotel);
  intentMap.set('BookFlights - BookHotel - Yes', bookHotelflightFollowup);
  intentMap.set('BookHotel - FlightContext', bookHotelflightcontext);
  intentMap.set('BookHotel - FlightContext - followup', bookHotel);
  intentMap.set('BookFlights - BookHotel - No', bookHotelExpireContext);
  intentMap.set('Loc - GetCity', getCity);
  intentMap.set('Loc - AskForPermission', askPermissionForLoc);
  intentMap.set('BookHotel - List Select', bookHotelResponse);
  intentMap.set('BookFlights - Payment Delay 2', paymentDelay2);
  intentMap.set('BookFlights - Payment Delay 1', paymentDelay1);
  agent.handleRequest(intentMap);
});
