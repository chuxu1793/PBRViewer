#version 330 core

layout (location = 0) out vec4 FragColor;

in vec2 TexCoords;
in vec3 Normal;  
in vec3 WorldPos;
in vec3 Tangent;
in vec3 Bitangent;

// ---------------------------------------------
//        --- Material parameters ---
// ---------------------------------------------

uniform sampler2D textureDiffuse[1];
uniform bool textureDiffuseAvailable;

uniform sampler2D textureNormal[1];
uniform bool textureNormalAvailable;

uniform sampler2D textureRoughness[1];
uniform bool textureRoughnessAvailable;

uniform sampler2D textureEmissive[1];
uniform bool textureEmissiveAvailable;

uniform samplerCube textureIrradiance[1];
uniform bool textureIrradianceAvailable;

uniform samplerCube texturePreFilterEnvironment[1];
uniform bool texturePrefilteredEnvironmentAvailable;

uniform sampler2D textureBRDFLookup[1];
uniform bool textureBRDFLookupAvailable;

// ---------------------------------------------
//                --- Camera ---
// ---------------------------------------------

uniform vec3 camPos; 

// ---------------------------------------------
//                --- Lights ---
// ---------------------------------------------

uniform vec3 lightPositions[4];
uniform bool isLightActive[4];
uniform vec3 lightColors[4];

// ---------------------------------------------
//                --- Shadows ---
// ---------------------------------------------

uniform bool shadowsEnabled;
uniform sampler2D textureShadows[4];
uniform bool textureShadowsAvailable;
uniform mat4 lightSpaceMatrices[4];

// ---------------------------------------------
//             --- User settings ---
// ---------------------------------------------

uniform int renderOutput;
uniform float gamma;
uniform float exposure;
uniform int blinnPhongExponent;

// ---------------------------------------------
//       --- Common shader functions ---
// ---------------------------------------------

vec3 GetNormalFromMap(const vec3 n, const vec3 t, const vec3 b);
float CalculateShadowCoverage(const vec4 fragPosLightSpace, const vec3 lightPos, const vec3 n, const int numberOfShadowMap);
vec4 ChooseRenderOutput(const vec3 albedo, const float ao, const vec2 brdfLookup, const vec3 color, const vec3 emissive, const float metallic, const float roughness);

// ---------------------------------------------
//              --- Constants ---
// ---------------------------------------------
const float Pi = 3.1415926f;

// The number 0.04 is the average reflective value of most dielectrics. It produces plausible results without the additional effort 
// to maintain a database for all materials (and determine which fragment is made of which material).	
const float DefaultFZeroDielectric = 0.04;

// ---------------------------------------------
//       --- Common shader functions ---
// ---------------------------------------------
vec3 fresnelSchlickRoughness(const float cosTheta, const vec3 F0, const float roughness);

// ---------------------------------------------
//            --- Main workflow ---
// ---------------------------------------------

void main()
{    	
	// There is only one texture for AO, roughness and metallic parameters	
	// Blinn/Phong only uses the ambient occlusion.
	float ao = 0.0f;	
	float roughness = 0.0f;
	float metallic = 0.0f;
	if(textureRoughnessAvailable)
	{
		ao = texture(textureRoughness[0], TexCoords).r;
		roughness = texture(textureRoughness[0], TexCoords).g;
		metallic = texture(textureRoughness[0], TexCoords).b;
	}		
	
	vec3 albedo = vec3(0.0f);
	if(textureDiffuseAvailable)
	{
		// Convert texture in sRGB format to linear space
		albedo = pow(texture(textureDiffuse[0], TexCoords).rgb, vec3(gamma));			
	}	
	
	// Not every model has specified an emissive texture
	vec3 emissive = vec3(0.0f);	
	if(textureEmissiveAvailable)
	{
		emissive = texture(textureEmissive[0], TexCoords).rgb;
	}	

   	vec3 n = Normal;
	if(textureNormalAvailable)
	{
		n = GetNormalFromMap(Normal, Tangent, Bitangent);
	}	

	vec3 v = normalize(camPos - WorldPos);	
	vec3 r = reflect(-1.0f * v, n); 

	vec3 Lo = vec3(0.0f);
	for(int i = 0; i < lightPositions.length(); ++i)
	{
		if(false == isLightActive[i])
		{
			continue;
		}
        
        vec3 l = normalize(lightPositions[i] - WorldPos);
		float nDotL = dot(n, l);		

		// The BRDF is only defined for light positions above the surface.
		// See RealTimeRendering 4th edition - p. 312
		if(nDotL <= 0.0f)
		{
			continue;
		}

		// Diffuse			
		vec3 diffuse = albedo / Pi;

		// Specular		  
		vec3 h = normalize(l + v);  
		float spec = pow(max(dot(n, h), 0.0f), blinnPhongExponent);   
		vec3 specular = spec * lightColors[i];

		// Attenuation
		float lightDistanceToFragment = length(lightPositions[i] - WorldPos);
		float attenuation = 1.0f / (lightDistanceToFragment * lightDistanceToFragment);		
		
		// Shadows are only relevant for the diffuse and specular part.
		float shadowCoverage = 0.0f;		
		if(textureShadowsAvailable)
		{
			shadowCoverage = CalculateShadowCoverage(lightSpaceMatrices[i] * vec4(WorldPos, 1.0f), lightPositions[i], n, i);
		}

		vec3 radiance = (1.0f - shadowCoverage) * lightColors[i] * attenuation;			

		vec3 diffSpec = (diffuse + specular) * radiance * nDotL;
		Lo += diffSpec;
	}	
	
	// Ambient lighting
	// If an irradiance map (skybox) is available, use this texture to calculate ambient light strength.
	// If not, use an arbitrary number as ambient strength.			
	vec2 brdfLookup  = vec2(0.0f);
	if(textureBRDFLookupAvailable)
	{
		brdfLookup = texture(textureBRDFLookup[0], vec2(max(dot(n, v), 0.0f), roughness)).rg;
	}

	vec3 ambient = vec3(0.0f);	
	if(textureIrradianceAvailable)
	{
		// Calculate reflectance at normal incidence; if dielectric (like plastic) use F0 
		// of 0.04 and if it's a metal, use the albedo color as F0 (metallic workflow).	
		vec3 F0 = vec3(DefaultFZeroDielectric); 
		F0 = mix(F0, albedo, metallic);

		vec3 kSAmbient = fresnelSchlickRoughness(max(dot(n, v), 0.0f), F0, roughness);
		vec3 kDAmbient = 1.0f - kSAmbient;
		kDAmbient *= 1.0f - metallic;		
		
		const float maximumLevelOfDetail = 4.0f;
		vec3 prefilteredColor = textureLod(texturePreFilterEnvironment[0], r,  roughness * maximumLevelOfDetail).rgb;    		
		vec3 specular = prefilteredColor * (kSAmbient * brdfLookup.x + brdfLookup.y);

		vec3 irradiance = texture(textureIrradiance[0], n).rgb;
		ambient = (kDAmbient * irradiance * albedo + specular) * ao;		
	}
	else
	{
		ambient = (vec3(0.01f) * albedo) * ao; 
	}	
    
	vec3 color = emissive + ambient + Lo;

	// Gamma correction
    color = pow(color, vec3(1.0f / gamma)); 	

	// Exposure tone mapping
    color = vec3(1.0f) - exp(-color * exposure);    
	
    FragColor = ChooseRenderOutput(albedo, ao, vec2(0.0f), color, emissive, 0.0f, 0.0f);	
}