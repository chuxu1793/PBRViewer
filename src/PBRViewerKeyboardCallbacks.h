#pragma once
#include <glad/glad.h>

#include "PBRViewerModel.h"
#include "PBRViewerOverlay.h"

#include <memory>

/// <summary>
/// This class registers the GLFW callbacks for the keyboard.
/// </summary>
class PBRViewerKeyboardCallbacks
{
public:
	/// <summary>
	/// Register the callbacks.
	/// </summary>
	/// <param name="currentWindow">The current window.</param>
	/// <param name="overlay">The overlay.</param>
	/// <param name="model">The model.</param>	
	static GLvoid RegisterCallbacks( GLFWwindow* currentWindow,
	                                 std::shared_ptr<PBRViewerOverlay> const& overlay,
	                                 std::shared_ptr<PBRViewerModel> const& model );
};
